// Cliente de partida: recibe instantáneas, predice el movimiento propio, interpola el resto,
// dispara efectos y sonidos y mantiene el HUD.
import {
  W, H, T, TICK_MS, TICK_RATE, RULES, ITEM, ITEMS, CURSES, CURSE_NAMES, ABILITIES, MODES, COLORS,
  TEAM_NAMES, TEAM_COLORS, MAPS, SNAP_EVERY,
} from './data.js';
import { moveStep, playerBlocker, OPP } from './move.js';
import { PF, PHASES } from './sim.js';
import { Renderer } from './render.js';
import { icon } from './icons.js';
import { fmtTime } from './util.js';

const N = W * H;
const $ = (root, sel) => root.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class GameClient {
  constructor({ root, roster, settings, you, isHost, room, input, sound, prefs, onExit, snap }) {
    this.root = root;
    this.room = room;
    this.input = input;
    this.sound = sound;
    this.prefs = prefs;
    this.onExit = onExit;
    this.isHost = isHost;
    this.settings = settings;
    this.mode = MODES[settings.mode];
    this.you = you;
    this.delay = isHost ? SNAP_EVERY : SNAP_EVERY * 2;
    this.canvas = $(root, '#board');
    this.renderer = new Renderer(this.canvas);
    this.renderer.shakeOn = prefs.shake;
    this.stage = $(root, '#stage');

    this.tiles = new Uint8Array(N);
    this.tilesKey = '';
    this.mapId = 'clasico';
    this.itemList = [];
    this.bombs = new Map();
    this.flames = [];
    this.burns = new Map();
    this.zone = null;
    this.scores = new Map();
    this.teamWins = [0, 0];
    this.phase = 'countdown';
    this.players = new Map();
    this.setRoster(roster);

    this.seq = 0;
    this.pending = [];
    this.pred = null;
    this.corr = { x: 0, y: 0 };
    this.acc = 0;
    this.renderK = null;
    this.latestK = 0;
    this.lastCount = null;
    this.results = null;
    this.alive = true;
    this.snapAt = performance.now();

    this.buildHud();
    this.applySnapshot(snap, true);
    this.input.enabled = true;
    this.input.onPause = () => this.togglePause();
    this.input.onChat = () => this.openChat();
    this.input.onScores = on => this.showScores(on);
    this.resize = () => this.layout();
    window.addEventListener('resize', this.resize);
    // Al ocultar la pestaña se deja de enviar entrada: se manda una parada explícita.
    this.onHide = () => { if (document.hidden && this.you >= 0) this.room.sendInput({ dir: 0, bomb: false, ability: false, seq: ++this.seq }); };
    document.addEventListener('visibilitychange', this.onHide);
    this.layout();
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
    this.hudInterval = setInterval(() => this.updateHud(), 120);
    if (prefs.music) sound.setMusic(true);
  }

  setRoster(roster) {
    this.roster = roster;
    for (const r of roster) {
      if (!this.players.has(r.slot)) {
        this.players.set(r.slot, {
          slot: r.slot, name: r.name, color: r.color, team: r.team, ability: r.ability, bot: r.bot,
          x: 1.5, y: 1.5, dir: 3, flags: 0, hist: [], moving: false, dying: -1, visible: false,
          bombs: 1, fire: 2, speedLvl: 0, abilityCd: 0, curse: '', respawnT: 0, ghostT: 0, isMe: r.slot === this.you,
        });
      }
    }
    if (this.hudPlayers) this.buildPlayerChips();
  }

  get me() { return this.players.get(this.you); }

  // -------------------------------------------------------- instantáneas
  applySnapshot(s, initial = false) {
    const now = performance.now();
    this.snapAt = now;
    this.latestK = s.k;
    if (this.renderK === null || initial) this.renderK = s.k - this.delay;
    const prevPhase = this.phase;
    this.phase = PHASES[s.ph] || 'play';
    this.phaseT = s.pt;
    this.timeLeft = s.tl;
    this.round = s.r;
    this.sudden = !!s.sd;

    if (typeof s.m === 'string' && s.m.length === N) {
      const old = this.tiles;
      const next = new Uint8Array(N);
      for (let i = 0; i < N; i++) next[i] = s.m.charCodeAt(i) - 48;
      if (!initial && s.mid === this.mapId) {
        for (let i = 0; i < N; i++) {
          if (old[i] === T.BLOCK && next[i] === T.BURN) this.debris(i);
        }
      }
      this.tiles = next;
      this.tilesKey = s.m;
      if (s.mid && MAPS[s.mid]) this.mapId = s.mid;
    }
    if (Array.isArray(s.it)) this.itemList = s.it;
    if (Array.isArray(s.sc)) {
      for (const [slot, score, wins, kills, deaths, left] of s.sc) this.scores.set(slot, { score, wins, kills, deaths, left: !!left });
      if (Array.isArray(s.tw)) this.teamWins = s.tw;
    }
    // bombas
    const seen = new Set();
    for (const [id, x, y, fuse, owner, slide] of s.b || []) {
      seen.add(id);
      const b = this.bombs.get(id);
      if (b) { b.tx = x / 100; b.ty = y / 100; b.fuse0 = fuse; b.slide = slide; }
      else this.bombs.set(id, { id, x: x / 100, y: y / 100, tx: x / 100, ty: y / 100, fuse0: fuse, fuse, owner, slide });
    }
    for (const id of this.bombs.keys()) if (!seen.has(id)) this.bombs.delete(id);
    this.bombTiles = new Set([...this.bombs.values()].map(b => Math.floor(b.ty) * W + Math.floor(b.tx)));
    this.flames = s.f || [];
    this.burns = new Map();
    for (let i = 0; i < (s.bu || []).length; i += 2) this.burns.set(s.bu[i], s.bu[i + 1]);
    this.zone = s.z ? { cx: s.z[0], cy: s.z[1], holder: s.z[2], moveT: s.z[3] } : null;

    // jugadores
    for (const e of s.p || []) {
      const [slot, x100, y100, dir, flags, ack, bombs, fire, speedLvl, abilityCd, curse, respawnT, ghostT] = e;
      const p = this.players.get(slot);
      if (!p) continue;
      const wasAlive = !!(p.flags & PF.ALIVE);
      const alive = !!(flags & PF.ALIVE);
      p.sx = x100 / 100; p.sy = y100 / 100;
      p.dirS = dir; p.flags = flags; p.bombs = bombs; p.fire = fire; p.speedLvl = speedLvl;
      p.abilityCd = abilityCd; p.curse = curse ? CURSES[curse - 1] : ''; p.respawnT = respawnT; p.ghostT = ghostT;
      p.ack = ack;
      p.hist.push({ k: s.k, x: p.sx, y: p.sy, dir, moving: !!(flags & PF.MOVING) });
      if (p.hist.length > 16) p.hist.shift();
      if (alive && !wasAlive) {
        p.dying = -1;
        p.hist = [{ k: s.k, x: p.sx, y: p.sy, dir, moving: false }];
        if (!initial) this.renderer.ring(p.sx, p.sy, '#ffffff', 1.1, 0.5);
        if (slot === this.you) { this.pred = { x: p.sx, y: p.sy }; this.pending = []; this.corr = { x: 0, y: 0 }; }
      }
      if (!alive && wasAlive && !initial && p.dying < 0) p.dying = 0;
      p.visible = alive || (p.dying >= 0 && p.dying < 0.8);
      if (initial) { p.x = p.sx; p.y = p.sy; p.dir = dir; }
    }
    this.reconcile();
    if (!initial) for (const e of s.ev || []) this.onEvent(e);
    if (prevPhase !== this.phase) this.onPhase(prevPhase);
  }

  // ---------------------------------------------------------- predicción
  world() { return { tiles: this.tiles, bombAt: idx => this.bombTiles && this.bombTiles.has(idx) }; }

  canPredict(p) {
    return p && (p.flags & PF.ALIVE) && !(p.flags & PF.FROZEN) && this.phase === 'play';
  }

  speedOf(p) {
    if (p.curse === 'slow') return 2.2;
    if (p.curse === 'fast') return 7.2;
    return RULES.baseSpeed + p.speedLvl * RULES.speedStep;
  }

  predictMove(pos, dir, p) {
    if (!dir) return;
    if (p.curse === 'reverse') dir = OPP[dir];
    const blocked = playerBlocker(this.world(), pos.x, pos.y, !!(p.flags & PF.GHOST));
    moveStep(pos, dir, this.speedOf(p) / TICK_RATE, blocked);
    pos.dir = dir;
  }

  reconcile() {
    const p = this.me;
    if (!p) return;
    if (!this.canPredict(p)) {
      this.pred = { x: p.sx, y: p.sy, dir: p.dirS };
      this.pending = [];
      return;
    }
    const before = this.pred ? { x: this.pred.x + this.corr.x, y: this.pred.y + this.corr.y } : null;
    this.pending = this.pending.filter(i => i.seq > p.ack);
    const pos = { x: p.sx, y: p.sy, dir: p.dirS };
    for (const i of this.pending) this.predictMove(pos, i.dir, p);
    if (before) {
      const dx = before.x - pos.x, dy = before.y - pos.y;
      if (Math.abs(dx) + Math.abs(dy) > 1.5) this.corr = { x: 0, y: 0 };
      else this.corr = { x: dx, y: dy };
    }
    this.pred = pos;
  }

  inputTick() {
    const inp = this.input.sample();
    if (this.paused || this.chatOpen) { inp.dir = 0; inp.bomb = false; inp.ability = false; }
    inp.seq = ++this.seq;
    this.room.sendInput(inp);
    const p = this.me;
    if (this.canPredict(p) && this.pred) {
      this.predictMove(this.pred, inp.dir, p);
      this.pending.push({ seq: inp.seq, dir: inp.dir });
      if (this.pending.length > 60) this.pending.shift();
    }
    if ((inp.bomb || inp.ability) && p && (p.flags & PF.ALIVE)) this.sound.unlock();
  }

  // ------------------------------------------------------------- bucle
  frame(now) {
    if (this.destroyed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.you >= 0) {
      this.acc += dt * 1000;
      let n = 0;
      while (this.acc >= TICK_MS && n < 5) { this.acc -= TICK_MS; this.inputTick(); n++; }
      if (n === 5) this.acc = 0;
    }
    // reloj de interpolación
    this.renderK += dt * TICK_RATE;
    const target = this.latestK - this.delay;
    const diff = target - this.renderK;
    if (Math.abs(diff) > 12) this.renderK = target;
    else this.renderK += diff * Math.min(1, dt * 4);

    const decay = Math.pow(0.0005, dt);
    this.corr.x *= decay; this.corr.y *= decay;
    for (const p of this.players.values()) {
      if (p.dying >= 0) p.dying += dt;
      if (p.slot === this.you && this.canPredict(p) && this.pred) {
        p.x = this.pred.x + this.corr.x; p.y = this.pred.y + this.corr.y;
        p.dir = this.pred.dir || p.dirS;
        p.moving = this.pending.length > 0 && this.pending[this.pending.length - 1].dir !== 0;
      } else this.interp(p);
      p.visible = !!(p.flags & PF.ALIVE) || (p.dying >= 0 && p.dying < 0.8);
    }
    const since = (now - this.snapAt) / TICK_MS;
    const lerpK = 1 - Math.pow(0.0001, dt);
    for (const b of this.bombs.values()) {
      b.x += (b.tx - b.x) * lerpK; b.y += (b.ty - b.y) * lerpK;
      b.fuse = b.fuse0 - since;
    }
    this.renderer.draw(this.view(), now, dt);
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  interp(p) {
    const h = p.hist;
    if (!h.length) return;
    const k = this.renderK;
    let a = h[0], b = h[h.length - 1];
    if (k <= a.k) { p.x = a.x; p.y = a.y; p.dir = a.dir; p.moving = a.moving; return; }
    if (k >= b.k) { p.x = b.x; p.y = b.y; p.dir = b.dir; p.moving = b.moving; return; }
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].k <= k) { a = h[i - 1]; b = h[i]; break; }
    }
    const t = (k - a.k) / Math.max(1, b.k - a.k);
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1.6) { p.x = b.x; p.y = b.y; }
    else { p.x = a.x + (b.x - a.x) * t; p.y = a.y + (b.y - a.y) * t; }
    p.dir = b.dir; p.moving = b.moving;
  }

  view() {
    return {
      mapId: this.mapId, tiles: this.tiles, tilesKey: this.tilesKey, itemList: this.itemList,
      bombs: this.bombs.values(), flames: this.flames, burns: this.burns, zone: this.zone,
      players: [...this.players.values()], teams: !!this.mode.teams,
    };
  }

  // ------------------------------------------------------------- eventos
  debris(idx) {
    const x = (idx % W) + 0.5, y = ((idx / W) | 0) + 0.5;
    const th = MAPS[this.mapId].theme;
    const cols = { cesped: ['#c98b4c', '#8a5a2e'], piedra: ['#b9a78a', '#7d6f59'], desierto: ['#f1d6a0', '#b8935b'], hielo: ['#eaf7ff', '#a2c3da'], volcan: ['#7c4c3a', '#ff7a2e'] }[th];
    this.renderer.burst(x, y, 9, { colors: cols, speed: 3.2, life: 0.55, size: 0.12, grav: 9, up: 2.5 });
  }

  onEvent(e) {
    const r = this.renderer, s = this.sound;
    const [type] = e;
    const mine = e[1] === this.you;
    switch (type) {
      case 'bomb': s.play('place', e[3] === this.you ? 0.9 : 0.5); break;
      case 'boom': {
        const [, x, y, fire] = e;
        s.play('boom', 0.6 + Math.min(0.4, fire * 0.05));
        r.addShake(0.12 + fire * 0.012);
        r.burst(x + 0.5, y + 0.5, 6, { colors: ['rgba(60,60,64,.55)', 'rgba(90,90,96,.45)'], type: 'smoke', speed: 1.2, life: 0.8, size: 0.2, drag: 0.92 });
        r.burst(x + 0.5, y + 0.5, 10, { colors: ['#ffd25e', '#ff8a2a', '#fff3c4'], speed: 5, life: 0.35, size: 0.07 });
        break;
      }
      case 'pick': {
        const [, slot, item, x, y] = e;
        const p = this.players.get(slot);
        if (item === ITEM.COIN) { s.play('coin', slot === this.you ? 1 : 0.4); r.text(x + 0.5, y + 0.2, '+', '#ffd23f'); }
        else if (item !== ITEM.SKULL) s.play('pick', slot === this.you ? 1 : 0.35);
        r.burst(x + 0.5, y + 0.5, 8, { colors: ['#ffffff', p ? COLORS[p.color].hex : '#fff'], speed: 2.5, life: 0.4, size: 0.07 });
        if (slot === this.you && ITEMS[item] && item !== ITEM.COIN && item !== ITEM.SKULL) this.toast(ITEMS[item].name);
        break;
      }
      case 'die': {
        const [, slot, by] = e;
        const p = this.players.get(slot);
        if (!p) break;
        p.dying = 0;
        s.play('die', mine ? 1 : 0.6);
        r.burst(p.x, p.y, 14, { colors: [COLORS[p.color].hex, '#ffffff', '#1d2027'], speed: 3.5, life: 0.7, size: 0.1, grav: 6 });
        const k = this.players.get(by);
        if (by === -1) this.feed(`${p.name} quedó aplastado`, p);
        else if (by === slot) this.feed(`${p.name} se voló a sí mismo`, p);
        else if (k) this.feed(`${k.name} eliminó a ${p.name}`, k, p);
        if (mine) { r.flash = 0.25; this.toast('Te han eliminado'); }
        break;
      }
      case 'abil': {
        const [, slot, id, a, b] = e;
        const p = this.players.get(slot);
        if (!p) break;
        const v = slot === this.you ? 1 : 0.5;
        s.play(id, v);
        if (id === 'dash') {
          const fx = a / 100, fy = b / 100;
          for (let i = 0; i < 6; i++) {
            const t = i / 6;
            r.particles.push({ type: 'trail', x: fx + (p.sx - fx) * t, y: fy + (p.sy - fy) * t, vx: 0, vy: 0, life: 0, max: 0.35 + t * 0.15, color: COLORS[p.color].hex, drag: 1 });
          }
        } else if (id === 'frost') r.ring(a / 100, b / 100, '#bfe9ff', 2.6, 0.6, 0.12);
        else if (id === 'barrier') r.ring(p.sx, p.sy, '#ffe14d', 0.9, 0.4);
        else if (id === 'builder') r.burst(a + 0.5, b + 0.5, 8, { colors: ['#ffffff', '#c0c4cc'], type: 'smoke', speed: 1, life: 0.5, size: 0.15 });
        else if (id === 'ghost') r.ring(p.sx, p.sy, '#d9d9ff', 0.9, 0.5);
        else if (id === 'detonator') r.ring(p.sx, p.sy, '#ff5050', 0.7, 0.3);
        break;
      }
      case 'frozen': if (mine) this.toast('¡Congelado!'); break;
      case 'kick': s.play('kick', 0.7); break;
      case 'curse': {
        const [, slot, c] = e;
        s.play('curse', slot === this.you ? 1 : 0.4);
        if (slot === this.you) this.toast(`Maldición: ${CURSE_NAMES[CURSES[c]]}`);
        break;
      }
      case 'shield': s.play('shield', mine ? 1 : 0.6); { const p = this.players.get(e[1]); if (p) r.ring(p.sx, p.sy, '#78dcff', 1, 0.4); } break;
      case 'fall': {
        const idx = e[2] * W + e[1];
        r.fallAt(idx, performance.now());
        setTimeout(() => { if (!this.destroyed) { s.play('fall', 0.5); r.addShake(0.05); } }, 230);
        break;
      }
      case 'sd': s.play('alarm', 1); this.banner('¡Muerte súbita!', 'danger', 1800); break;
      case 'round': this.mapId = e[2] || this.mapId; break;
      case 'go': s.play('go', 1); this.banner('¡Ya!', 'go', 700); break;
      case 'rend': this.onRoundEnd(e[1], e[2], e[3]); break;
      case 'zone': this.toast('La zona se ha movido'); s.play('join', 0.6); r.ring(e[1] + 0.5, e[2] + 0.5, '#ffffff', 2, 0.6); break;
      case 'burnitem': r.burst(e[1] + 0.5, e[2] + 0.5, 5, { colors: ['rgba(80,80,80,.5)'], type: 'smoke', speed: 0.8, life: 0.5, size: 0.15 }); break;
      case 'fail': if (mine) s.play('fail', 0.7); break;
      case 'left': { const p = this.players.get(e[1]); if (p) this.feed(`${p.name} ha salido`, p); break; }
      case 'joined': { const p = this.players.get(e[1]); if (p) { this.feed(`${p.name} se une a la partida`, p); s.play('join', 0.6); } break; }
      default: break;
    }
  }

  onPhase(prev) {
    if (this.phase === 'countdown') {
      this.hideBanner();
      this.lastCount = null;
      if (prev === 'roundEnd' || prev === 'countdown') this.banner(`Ronda ${this.round}`, 'info', 1100);
    }
  }

  onRoundEnd(winner, team, final) {
    const p = this.players.get(winner);
    let text, cls = 'info';
    if (this.mode.teams) {
      text = team >= 0 ? `Ronda para los ${TEAM_NAMES[team]}` : 'Empate';
      if (team >= 0) cls = team === 0 ? 'team0' : 'team1';
    } else if (this.mode.timed) text = p ? `¡${p.name} gana la partida!` : '¡Tiempo! Empate';
    else text = p ? `Ronda para ${p.name}` : 'Empate: no queda nadie';
    if (p && winner === this.you) { this.sound.play('win', 1); cls = 'win'; }
    else if (this.mode.teams && team >= 0 && this.me && this.me.team === team) { this.sound.play('win', 1); cls = 'win'; }
    this.banner(text, cls, final ? 3200 : 2600);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const root = this.root;
    this.hudPlayers = $(root, '#hudPlayers');
    this.hudTimer = $(root, '#hudTimer');
    this.hudMode = $(root, '#hudMode');
    this.hudRound = $(root, '#hudRound');
    this.hudSelf = $(root, '#hudSelf');
    this.hudPing = $(root, '#hudPing');
    this.bannerEl = $(root, '#banner');
    this.feedEl = $(root, '#killfeed');
    this.toastEl = $(root, '#gameToast');
    this.respawnEl = $(root, '#respawnNote');
    this.feedEl.textContent = '';
    this.hideBanner();
    this.hudMode.textContent = this.mode.name;
    this.buildPlayerChips();
    // panel propio
    this.hudSelf.textContent = '';
    this.selfEls = {};
    const stat = (key, ico, title) => {
      const d = el('div', 'stat');
      d.title = title;
      d.innerHTML = icon(ico);
      const v = el('span', 'v', '1');
      d.appendChild(v);
      this.hudSelf.appendChild(d);
      this.selfEls[key] = { box: d, v };
    };
    stat('bombs', 'bomb', 'Bombas');
    stat('fire', 'fire', 'Alcance');
    stat('speed', 'speed', 'Velocidad');
    const badges = el('div', 'badges');
    for (const [k, ico, t] of [['kick', 'kick', 'Patada'], ['pierce', 'pierce', 'Perforante'], ['shield', 'shield', 'Escudo'], ['curse', 'skull', 'Maldición']]) {
      const b = el('span', `badge b-${k}`);
      b.title = t;
      b.innerHTML = icon(ico);
      badges.appendChild(b);
      this.selfEls[k] = b;
    }
    this.hudSelf.appendChild(badges);
    if (this.settings.abilities && this.me && this.me.ability) {
      const ab = ABILITIES[this.me.ability];
      const a = el('button', 'ability');
      a.type = 'button';
      a.title = `${ab.name}: ${ab.desc} (Mayús o K)`;
      a.innerHTML = `${icon(this.me.ability)}<span class="cd"></span><span class="key">Mayús</span>`;
      a.addEventListener('click', () => { this.input.abilityPress++; });
      this.hudSelf.appendChild(a);
      this.selfEls.ability = a;
    }
    if (this.you < 0) {
      this.hudSelf.textContent = '';
      this.hudSelf.appendChild(el('div', 'spectating', 'Estás mirando esta partida. Jugarás en la siguiente.'));
    }
    // táctil
    const touch = $(root, '#touch');
    const showTouch = this.prefs.touch === 'on' || (this.prefs.touch === 'auto' && matchMedia('(pointer: coarse)').matches);
    touch.hidden = !showTouch || this.you < 0;
    root.classList.toggle('has-touch', !touch.hidden);
    const tab = $(touch, '.tbtn-ability');
    tab.hidden = !(this.settings.abilities && this.me && this.me.ability);
    if (!tab.hidden) tab.innerHTML = `${icon(this.me.ability)}<span class="cd"></span>`;
    this.touchAbility = tab.hidden ? null : tab;
    if (!this.touchBound) { this.input.bindTouch(touch); this.touchBound = true; }
  }

  buildPlayerChips() {
    this.hudPlayers.textContent = '';
    this.chips = new Map();
    const list = [...this.roster].sort((a, b) => (this.mode.teams ? a.team - b.team : 0) || a.slot - b.slot);
    if (this.mode.teams) {
      this.teamEls = [0, 1].map(t => {
        const d = el('div', `teamscore t${t}`);
        d.style.setProperty('--team', TEAM_COLORS[t]);
        d.appendChild(el('span', 'tn', TEAM_NAMES[t]));
        const v = el('b', 'tv', '0');
        d.appendChild(v);
        return { d, v };
      });
    }
    let lastTeam = -1;
    for (const r of list) {
      if (this.mode.teams && r.team !== lastTeam) { this.hudPlayers.appendChild(this.teamEls[r.team].d); lastTeam = r.team; }
      const c = el('div', 'chip');
      c.style.setProperty('--pc', COLORS[r.color].hex);
      if (r.slot === this.you) c.classList.add('me');
      c.appendChild(el('span', 'dot'));
      c.appendChild(el('span', 'nm', r.name));
      const v = el('span', 'val', '');
      c.appendChild(v);
      this.hudPlayers.appendChild(c);
      this.chips.set(r.slot, { c, v });
    }
  }

  updateHud() {
    if (this.destroyed) return;
    // temporizador
    let t;
    if (this.phase === 'countdown') {
      const n = Math.ceil(this.phaseT / TICK_RATE);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; this.banner(String(n), 'count', 900); this.sound.play('tick', 0.8); }
    }
    if (this.mode.rounds) {
      t = this.sudden ? '¡Muerte súbita!' : fmtTime(this.timeLeft);
      this.hudRound.textContent = `Ronda ${this.round}, gana quien llegue a ${this.settings.rounds}`;
    } else {
      t = fmtTime(this.timeLeft);
      this.hudRound.textContent = this.settings.mode === 'zone' ? `Meta: ${this.settings.zoneTarget} puntos` : this.settings.mode === 'loot' ? 'Más monedas al final' : 'Más derribos al final';
    }
    this.hudTimer.textContent = t;
    this.hudTimer.classList.toggle('danger', !!(this.sudden || (this.mode.timed && this.timeLeft < TICK_RATE * 10)));
    // jugadores
    for (const [slot, { c, v }] of this.chips) {
      const p = this.players.get(slot), sc = this.scores.get(slot) || {};
      const alive = p && (p.flags & PF.ALIVE);
      c.classList.toggle('dead', !alive);
      c.classList.toggle('left', !!sc.left);
      if (this.mode.rounds) {
        const wins = sc.wins || 0;
        v.textContent = '';
        if (!this.mode.teams) for (let i = 0; i < this.settings.rounds; i++) v.appendChild(el('i', i < wins ? 'pip on' : 'pip'));
      } else v.textContent = String(sc.score || 0);
    }
    if (this.mode.teams && this.teamEls) this.teamEls.forEach((t2, i) => { t2.v.textContent = String(this.teamWins[i] || 0); });
    // panel propio
    const me = this.me;
    if (me && this.selfEls.bombs) {
      const out = [...this.bombs.values()].filter(b => b.owner === me.slot).length;
      this.selfEls.bombs.v.textContent = `${Math.max(0, me.bombs - out)}/${me.bombs}`;
      this.selfEls.fire.v.textContent = String(me.fire);
      this.selfEls.speed.v.textContent = String(me.speedLvl + 1);
      this.selfEls.kick.classList.toggle('on', !!(me.flags & PF.KICK));
      this.selfEls.pierce.classList.toggle('on', !!(me.flags & PF.PIERCE));
      this.selfEls.shield.classList.toggle('on', !!(me.flags & PF.SHIELD));
      this.selfEls.curse.classList.toggle('on', !!me.curse);
      this.selfEls.curse.title = me.curse ? `Maldición: ${CURSE_NAMES[me.curse]}` : 'Maldición';
      if (this.selfEls.ability) {
        const total = ABILITIES[me.ability].cd;
        const k = Math.max(0, Math.min(1, me.abilityCd / total));
        this.selfEls.ability.style.setProperty('--cd', String(k));
        this.selfEls.ability.classList.toggle('ready', k === 0);
        this.selfEls.ability.querySelector('.cd').textContent = k > 0 ? String(Math.ceil(me.abilityCd / TICK_RATE)) : '';
        if (this.touchAbility) {
          this.touchAbility.style.setProperty('--cd', String(k));
          this.touchAbility.classList.toggle('ready', k === 0);
          this.touchAbility.querySelector('.cd').textContent = k > 0 ? String(Math.ceil(me.abilityCd / TICK_RATE)) : '';
        }
      }
      const dead = !(me.flags & PF.ALIVE) && this.mode.respawn && this.phase === 'play' && me.respawnT > 0;
      this.respawnEl.hidden = !dead;
      if (dead) this.respawnEl.textContent = `Reapareces en ${Math.ceil(me.respawnT / TICK_RATE)}…`;
    } else this.respawnEl.hidden = true;
    if (this.room.role === 'client') this.hudPing.textContent = this.room.rtt ? `${Math.round(this.room.rtt)} ms` : '';
    else this.hudPing.textContent = this.room.local ? 'Práctica' : 'Anfitrión';
  }

  banner(text, cls, ms) {
    const b = this.bannerEl;
    b.textContent = text;
    b.className = `banner show ${cls || ''}`;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => this.hideBanner(), ms);
  }
  hideBanner() { this.bannerEl.className = 'banner'; }

  feed(text, a, b) {
    const d = el('div', 'feedline');
    d.textContent = text;
    if (a) d.style.setProperty('--pc', COLORS[a.color].hex);
    void b;
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 4500);
    setTimeout(() => d.remove(), 5200);
  }

  chatLine(msg) {
    const d = el('div', 'feedline chat');
    if (msg.sys) d.textContent = msg.text;
    else {
      const n = el('b', '', `${msg.name}: `);
      n.style.color = COLORS[msg.color % COLORS.length].hex;
      d.appendChild(n);
      d.appendChild(document.createTextNode(msg.text));
    }
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 6) this.feedEl.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 7000);
    setTimeout(() => d.remove(), 7800);
  }

  toast(text) {
    const t = this.toastEl;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  // ------------------------------------------------------- menús de juego
  togglePause(force) {
    const m = $(this.root, '#pauseMenu');
    if (this.results) return;
    this.paused = force !== undefined ? force : !this.paused;
    m.hidden = !this.paused;
    if (this.paused) $(m, 'button').focus();
  }

  openChat() {
    if (this.room.local) return;
    const bar = $(this.root, '#gameChat');
    const inp = $(bar, 'input');
    bar.hidden = false;
    this.chatOpen = true;
    inp.value = '';
    inp.focus();
    const close = send => {
      if (send && inp.value.trim()) this.room.chat(inp.value);
      bar.hidden = true;
      this.chatOpen = false;
      inp.onkeydown = null;
      inp.onblur = null;
      inp.blur();
    };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      else if (e.key === 'Escape') { e.preventDefault(); close(false); }
      e.stopPropagation();
    };
    inp.onblur = () => close(false);
  }

  showScores(on) {
    const box = $(this.root, '#scoreboard');
    if (!on) { box.hidden = true; return; }
    this.fillTable($(box, 'tbody'), this.rankRows());
    box.hidden = false;
  }

  rankRows() {
    const rows = this.roster.map(r => ({ r, sc: this.scores.get(r.slot) || { score: 0, wins: 0, kills: 0, deaths: 0 } }));
    rows.sort((a, b) => (this.mode.timed ? b.sc.score - a.sc.score : b.sc.wins - a.sc.wins) || b.sc.kills - a.sc.kills || a.sc.deaths - b.sc.deaths);
    return rows.map(({ r, sc }) => ({ slot: r.slot, name: r.name, color: r.color, team: r.team, ...sc }));
  }

  fillTable(tbody, rows) {
    tbody.textContent = '';
    rows.forEach((row, i) => {
      const tr = el('tr');
      if (row.slot === this.you) tr.className = 'me';
      tr.appendChild(el('td', 'pos', String(i + 1)));
      const name = el('td');
      const wrap = el('div', 'name');
      const dot = el('span', 'dot');
      dot.style.background = COLORS[row.color].hex;
      wrap.appendChild(dot);
      wrap.appendChild(document.createTextNode(row.name + (row.left ? ' (salió)' : '')));
      if (this.mode.teams) {
        const t = el('span', 'teamtag', TEAM_NAMES[row.team]);
        t.style.color = TEAM_COLORS[row.team];
        wrap.appendChild(t);
      }
      name.appendChild(wrap);
      tr.appendChild(name);
      tr.appendChild(el('td', 'num', String(this.mode.timed ? row.score : row.wins)));
      tr.appendChild(el('td', 'num', String(row.kills)));
      tr.appendChild(el('td', 'num', String(row.deaths)));
      tbody.appendChild(tr);
    });
  }

  showResults(results) {
    this.results = results;
    this.togglePause(false);
    this.paused = false;
    $(this.root, '#pauseMenu').hidden = true;
    const box = $(this.root, '#results');
    const rows = (results && Array.isArray(results.rows) ? results.rows : []).map(r => {
      const p = this.players.get(r.slot) || { name: '?', color: 0, team: 0 };
      return { slot: r.slot, name: p.name, color: p.color, team: p.team, score: r.score | 0, wins: r.wins | 0, kills: r.kills | 0, deaths: r.deaths | 0, left: !!r.left };
    });
    let title;
    if (this.mode.teams) {
      const t = results && results.winnerTeam;
      title = t === 0 || t === 1 ? `Ganan los ${TEAM_NAMES[t]}` : 'Empate';
    } else {
      const top = rows[0], second = rows[1];
      const tied = top && second && (this.mode.timed ? top.score === second.score : top.wins === second.wins);
      title = !top || tied ? 'Empate' : top.slot === this.you ? '¡Has ganado!' : `Gana ${top.name}`;
    }
    $(box, '.res-title').textContent = title;
    $(box, '.res-mode').textContent = `${this.mode.name}${this.mode.teams ? `: ${this.teamWins[0]} a ${this.teamWins[1]}` : ''}`;
    $(box, 'th.col-main').textContent = this.mode.timed ? (this.settings.mode === 'loot' ? 'Monedas' : 'Puntos') : 'Rondas';
    this.fillTable($(box, 'tbody'), rows);
    const host = this.isHost;
    $(box, '#resBack').hidden = !host;
    $(box, '#resWait').hidden = host;
    box.hidden = false;
    this.input.enabled = false;
  }

  layout() {
    const cs = getComputedStyle(this.stage);
    const w = this.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = this.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    this.renderer.resize(Math.max(100, w), Math.max(100, h));
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.hudInterval);
    clearTimeout(this.bannerT);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onHide);
    this.input.enabled = false;
    this.input.onPause = null;
    this.input.onChat = null;
    this.input.onScores = null;
    $(this.root, '#results').hidden = true;
    $(this.root, '#pauseMenu').hidden = true;
    $(this.root, '#scoreboard').hidden = true;
    this.sound.setMusic(false);
  }
}

// Simulación autoritativa de Bomber. Solo la ejecuta el anfitrión; los clientes reciben
// instantáneas. No depende del DOM, así que también se prueba con Node.
import {
  T, W, H, RULES, ITEM, ITEMS, CURSES, ABILITIES, MODES, MAPS, MAP_IDS, SPAWNS, ZONES,
  POWERUP_RATES, normalizeSettings, secs, TICK_RATE,
} from './data.js';
import { DX, DY, OPP, moveStep, playerBlocker, overlapTiles, aligned } from './move.js';
import { dangerMap } from './danger.js';
import { mulberry32, shuffle } from './util.js';

const N = W * H;
const bit = dir => 1 << (dir - 1);
export const PHASES = ['countdown', 'play', 'roundEnd', 'over'];
export const PF = { ALIVE: 1, MOVING: 2, INVULN: 4, SHIELD: 8, GHOST: 16, FROZEN: 32, KICK: 64, PIERCE: 128, LEFT: 256, BARRIER: 512 };

function speedOf(p) {
  if (p.curse === 'slow') return 2.2;
  if (p.curse === 'fast') return 7.2;
  return RULES.baseSpeed + p.speedLvl * RULES.speedStep;
}
export { speedOf };

export class Sim {
  constructor({ settings, roster, seed = 1 }) {
    this.settings = normalizeSettings(settings);
    this.modeId = this.settings.mode;
    this.mode = MODES[this.modeId];
    this.rand = mulberry32(seed);
    this.tick = 0;
    this.round = 0;
    this.events = [];
    this.teamWins = [0, 0];
    this.mapVer = 0; this.itemsVer = 0; this.scoreVer = 0;
    this.nextBombId = 1;
    this.players = roster.map(r => ({
      slot: r.slot, id: r.id, name: r.name, color: r.color, team: r.team | 0,
      ability: r.ability, bot: !!r.bot,
      x: 1.5, y: 1.5, dir: 3, moving: false, alive: false, left: false,
      wins: 0, kills: 0, deaths: 0, score: 0, zoneTicks: 0, ack: 0,
    }));
    this.bySlot = new Map(this.players.map(p => [p.slot, p]));
    if (this.mode.timed) this.timeLeft = this.settings.matchTime * TICK_RATE;
    this.startRound();
  }

  ev(...e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------------------------------------------------------------- rondas
  startRound() {
    this.round++;
    const s = this.settings;
    this.mapId = s.map === 'random' ? MAP_IDS[Math.floor(this.rand() * MAP_IDS.length)] : s.map;
    const map = MAPS[this.mapId];
    this.tiles = new Uint8Array(N);
    this.items = new Uint8Array(N);
    this.itemVal = new Uint16Array(N);
    this.hidden = new Uint8Array(N);
    this.hiddenVal = new Uint16Array(N);
    this.flame = new Uint8Array(N);
    this.flameT = new Uint8Array(N);
    this.flameOwner = new Int8Array(N).fill(-1);
    this.burnT = new Uint8Array(N);
    this.bombs = [];
    this.bombMap = new Map();
    this.sudden = false;
    this.suddenIdx = 0;
    this.endPending = 0;
    this.matchOver = false;
    this.lastWinner = -1;

    const active = this.players.filter(p => !p.left);
    const spawnSlots = this.assignSpawns(active);
    const clearSet = new Set();
    const used = this.mode.respawn ? SPAWNS : [...spawnSlots.values()];
    for (const [sx, sy] of used) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        clearSet.add((sy + dy) * W + (sx + dx));
      }
    }
    if (this.modeId === 'zone') {
      this.zoneOrder = shuffle(ZONES.map((z, i) => i).slice(1), this.rand);
      this.zoneOrder.unshift(0);
      this.zonePos = 0;
      const [cx, cy] = ZONES[0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clearSet.add((cy + dy) * W + cx + dx);
    }
    const rate = POWERUP_RATES[s.powerups];
    for (let y = 0; y < H; y++) {
      const row = map.rows[y];
      for (let x = 0; x < W; x++) {
        const ch = row[x], idx = y * W + x;
        if (ch === '#') this.tiles[idx] = T.WALL;
        else if (ch === '+' && !clearSet.has(idx) && this.rand() < map.density) {
          this.tiles[idx] = T.BLOCK;
          this.hideItem(idx, rate);
        }
      }
    }
    this.initialBlocks = this.countBlocks();

    for (const p of active) {
      const [sx, sy] = spawnSlots.get(p.slot);
      this.resetPlayer(p);
      p.x = sx + 0.5; p.y = sy + 0.5;
      p.alive = true;
      p.dir = 3;
      p.abilityCd = secs(2);
    }
    if (this.modeId === 'zone') this.zone = { cx: ZONES[0][0], cy: ZONES[0][1], holder: -1, moveT: secs(20) };
    if (this.modeId === 'loot') { this.coinT = secs(3); for (let i = 0; i < 6; i++) this.spawnCoin(); }
    this.regenT = secs(10);
    if (this.mode.rounds) this.timeLeft = this.settings.roundTime * TICK_RATE;
    this.phase = 'countdown';
    this.phaseT = RULES.countdown;
    this.mapVer++; this.itemsVer++; this.scoreVer++;
    this.ev('round', this.round, this.mapId);
  }

  assignSpawns(active) {
    const res = new Map();
    const n = active.length;
    if (this.modeId === 'teams') {
      const sides = [[[1, 1], [1, 11], [1, 6], [8, 1]], [[15, 11], [15, 1], [15, 6], [8, 11]]];
      const spare = [];
      const byTeam = [[], []];
      for (const p of active) byTeam[p.team ? 1 : 0].push(p);
      for (let t = 0; t < 2; t++) {
        const list = shuffle(byTeam[t].slice(), this.rand);
        list.forEach((p, i) => { if (i < 4) res.set(p.slot, sides[t][i]); else spare.push(p); });
      }
      const free = [...sides[0], ...sides[1]].filter(s => ![...res.values()].includes(s));
      spare.forEach((p, i) => res.set(p.slot, free[i % free.length]));
      return res;
    }
    const pool = n <= 4 ? SPAWNS.slice(0, 4) : SPAWNS.slice(0, Math.max(n, 4));
    shuffle(pool, this.rand);
    active.forEach((p, i) => res.set(p.slot, pool[i % pool.length]));
    return res;
  }

  hideItem(idx, rate) {
    if (this.modeId === 'loot' && this.rand() < 0.3) { this.hidden[idx] = ITEM.COIN; this.hiddenVal[idx] = 1; return; }
    if (this.rand() >= rate) return;
    let total = 0;
    for (const k in ITEMS) total += ITEMS[k].weight;
    let r = this.rand() * total;
    for (const k in ITEMS) {
      r -= ITEMS[k].weight;
      if (r < 0) { this.hidden[idx] = Number(k); return; }
    }
  }

  countBlocks() { let c = 0; for (let i = 0; i < N; i++) if (this.tiles[i] === T.BLOCK) c++; return c; }

  resetPlayer(p) {
    p.bombs = RULES.baseBombs; p.fire = RULES.baseFire; p.speedLvl = 0;
    p.kick = false; p.pierce = false; p.shield = false;
    p.invuln = 0; p.barrier = 0; p.ghost = 0; p.frozen = 0; p.curse = ''; p.curseT = 0;
    p.respawnT = 0; p.moving = false;
  }

  // ------------------------------------------------------------- jugadores
  // Incorporación a mitad de partida (solo modos con reaparición).
  addPlayer(r) {
    if (this.bySlot.has(r.slot)) return null;
    const p = {
      slot: r.slot, id: r.id, name: r.name, color: r.color, team: r.team | 0, ability: r.ability, bot: !!r.bot,
      x: 1.5, y: 1.5, dir: 3, moving: false, alive: false, left: false,
      wins: 0, kills: 0, deaths: 0, score: 0, zoneTicks: 0, ack: 0,
    };
    this.resetPlayer(p);
    p.respawnT = 1;
    p.abilityCd = 0;
    this.players.push(p);
    this.bySlot.set(p.slot, p);
    this.scoreVer++;
    this.ev('joined', p.slot);
    return p;
  }

  removePlayer(slot) {
    const p = this.bySlot.get(slot);
    if (!p || p.left) return;
    p.left = true;
    p.alive = false;
    this.ev('left', slot);
    this.scoreVer++;
  }

  world() {
    if (!this._world) this._world = { tiles: null, bombAt: idx => this.bombMap.has(idx) };
    this._world.tiles = this.tiles;
    return this._world;
  }

  isEnemy(a, b) {
    if (a === b) return false;
    if (this.modeId === 'teams') return a.team !== b.team;
    return true;
  }

  // ------------------------------------------------------------------ tick
  // inputs: Map(slot -> { dir, bomb, ability, seq })
  step(inputs) {
    this.tick++;
    if (this.phase === 'countdown') {
      if (--this.phaseT <= 0) { this.phase = 'play'; this.ev('go'); }
      this.ackInputs(inputs);
      return;
    }
    if (this.phase === 'roundEnd') {
      this.ackInputs(inputs);
      this.decayTimers();
      if (--this.phaseT <= 0) {
        if (this.matchOver) { this.phase = 'over'; this.ev('over'); }
        else this.startRound();
      }
      return;
    }
    if (this.phase === 'over') return;

    this.decayTimers();
    for (const p of this.players) {
      const inp = inputs && inputs.get(p.slot);
      if (inp && inp.seq) p.ack = inp.seq;
      if (p.left) continue;
      if (!p.alive) { this.tickDead(p); continue; }
      this.tickPlayer(p, inp || { dir: 0 });
    }
    this.contagion();
    this.tickBombs();
    this.damage();
    if (this.sudden) this.tickSudden();
    this.tickMode();
    this.checkEnd();
  }

  ackInputs(inputs) {
    if (!inputs) return;
    for (const [slot, inp] of inputs) {
      const p = this.bySlot.get(slot);
      if (p && inp && inp.seq) p.ack = inp.seq;
    }
  }

  decayTimers() {
    for (let i = 0; i < N; i++) {
      if (this.flameT[i] > 0 && --this.flameT[i] === 0) { this.flame[i] = 0; this.flameOwner[i] = -1; }
      if (this.burnT[i] > 0 && --this.burnT[i] === 0) {
        this.tiles[i] = T.FLOOR;
        this.mapVer++;
        if (this.hidden[i]) {
          this.items[i] = this.hidden[i]; this.itemVal[i] = this.hiddenVal[i];
          this.hidden[i] = 0; this.hiddenVal[i] = 0;
          this.itemsVer++;
        }
      }
    }
    if (this.mode.rounds && this.phase === 'play') {
      if (this.timeLeft > 0 && --this.timeLeft === 0) { this.sudden = true; this.ev('sd'); }
    }
  }

  tickDead(p) {
    if (!this.mode.respawn || this.phase !== 'play') return;
    if (p.respawnT > 0 && --p.respawnT === 0) this.respawn(p);
  }

  tickPlayer(p, inp) {
    if (p.invuln > 0) p.invuln--;
    if (p.barrier > 0) p.barrier--;
    if (p.frozen > 0) p.frozen--;
    if (p.abilityCd > 0) p.abilityCd--;
    if (p.ghost > 0 && --p.ghost === 0) this.unstick(p);
    if (p.curseT > 0 && --p.curseT === 0) { p.curse = ''; }

    let dir = inp.dir | 0;
    if (dir < 0 || dir > 4) dir = 0;
    if (p.curse === 'reverse' && dir) dir = OPP[dir];
    p.moving = false;
    if (dir && !p.frozen) {
      p.dir = dir;
      const want = speedOf(p) / TICK_RATE;
      const blocked = playerBlocker(this.world(), p.x, p.y, p.ghost > 0);
      const moved = moveStep(p, dir, want, blocked);
      p.moving = moved > 0.0005;
      if (moved < want * 0.5 && p.kick) this.tryKick(p, dir);
    }
    if (!p.frozen) {
      if (inp.bomb || p.curse === 'diarrhea') this.placeBomb(p, !inp.bomb);
      if (inp.ability) this.useAbility(p);
    }
    // recoger potenciadores
    const idx = Math.floor(p.y) * W + Math.floor(p.x);
    if (this.items[idx]) this.pickup(p, idx);
  }

  // Si termina el efecto Fantasma dentro de un bloque, se le saca a la casilla libre más cercana.
  unstick(p) {
    const solid = i => this.tiles[i] !== T.FLOOR;
    const over = overlapTiles(p.x, p.y);
    if (!over.some(solid)) return;
    const start = Math.floor(p.y) * W + Math.floor(p.x);
    const seen = new Uint8Array(N); const q = [start]; seen[start] = 1;
    while (q.length) {
      const i = q.shift();
      if (!solid(i) && !this.bombMap.has(i)) { p.x = (i % W) + 0.5; p.y = ((i / W) | 0) + 0.5; return; }
      for (let d = 1; d <= 4; d++) {
        const x = (i % W) + DX[d], y = ((i / W) | 0) + DY[d];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (!seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
  }

  tryKick(p, dir) {
    if (!aligned(p, dir)) return;
    const tx = Math.floor(p.x) + DX[dir], ty = Math.floor(p.y) + DY[dir];
    const idx = ty * W + tx;
    const b = this.bombMap.get(idx);
    if (!b || b.slide) return;
    if (overlapTiles(p.x, p.y).includes(idx)) return;
    b.slide = dir;
    this.ev('kick', tx, ty);
  }

  bombsOf(slot) { let c = 0; for (const b of this.bombs) if (b.owner === slot) c++; return c; }

  placeBomb(p, auto) {
    if (p.curse === 'nobomb') return false;
    const tx = Math.floor(p.x), ty = Math.floor(p.y), idx = ty * W + tx;
    if (this.tiles[idx] !== T.FLOOR || this.bombMap.has(idx)) return false;
    if (this.bombsOf(p.slot) >= p.bombs) return false;
    const b = {
      id: this.nextBombId++, owner: p.slot, x: tx + 0.5, y: ty + 0.5,
      fuse: p.curse === 'shortfuse' ? RULES.shortFuse : RULES.fuse,
      fire: p.fire, pierce: p.pierce, slide: 0,
    };
    this.bombs.push(b);
    this.bombMap.set(idx, b);
    this.ev('bomb', tx, ty, p.slot, auto ? 1 : 0);
    return true;
  }

  pickup(p, idx) {
    const it = this.items[idx], val = this.itemVal[idx];
    this.items[idx] = 0; this.itemVal[idx] = 0; this.itemsVer++;
    switch (it) {
      case ITEM.BOMB: p.bombs = Math.min(RULES.maxBombs, p.bombs + 1); break;
      case ITEM.FIRE: p.fire = Math.min(RULES.maxFire, p.fire + 1); break;
      case ITEM.SPEED: p.speedLvl = Math.min(RULES.maxSpeedLvl, p.speedLvl + 1); break;
      case ITEM.KICK: p.kick = true; break;
      case ITEM.PIERCE: p.pierce = true; break;
      case ITEM.SHIELD: p.shield = true; break;
      case ITEM.MAXFIRE: p.fire = RULES.maxFire; break;
      case ITEM.SKULL:
        p.curse = CURSES[Math.floor(this.rand() * CURSES.length)];
        p.curseT = RULES.curse;
        this.ev('curse', p.slot, CURSES.indexOf(p.curse));
        break;
      case ITEM.COIN:
        p.score += val || 1; this.scoreVer++;
        break;
    }
    this.ev('pick', p.slot, it, idx % W, (idx / W) | 0);
  }

  contagion() {
    const ps = this.players.filter(p => p.alive);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (!!a.curse === !!b.curse) continue;
      if (Math.abs(a.x - b.x) < 0.8 && Math.abs(a.y - b.y) < 0.8) {
        const [src, dst] = a.curse ? [a, b] : [b, a];
        dst.curse = src.curse; dst.curseT = RULES.curse;
        this.ev('curse', dst.slot, CURSES.indexOf(dst.curse));
      }
    }
  }

  // ------------------------------------------------------------- habilidades
  useAbility(p) {
    if (!this.settings.abilities || p.abilityCd > 0) return;
    const id = p.ability;
    const ab = ABILITIES[id];
    if (!ab) return;
    let ok = true;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    switch (id) {
      case 'dash': {
        const fx = p.x, fy = p.y;
        let total = 0;
        for (let i = 0; i < 12 && total < 3; i++) {
          const blocked = playerBlocker(this.world(), p.x, p.y, p.ghost > 0);
          const m = moveStep(p, p.dir, Math.min(0.25, 3 - total), blocked);
          if (m <= 0.0005) break;
          total += m;
        }
        if (total < 0.3) { ok = false; break; }
        this.ev('abil', p.slot, id, Math.round(fx * 100), Math.round(fy * 100));
        const idx = Math.floor(p.y) * W + Math.floor(p.x);
        if (this.items[idx]) this.pickup(p, idx);
        break;
      }
      case 'barrier':
        p.barrier = secs(1.5);
        p.invuln = Math.max(p.invuln, secs(1.5));
        this.ev('abil', p.slot, id, tx, ty);
        break;
      case 'builder': {
        const bx = tx + DX[p.dir], by = ty + DY[p.dir];
        const idx = by * W + bx;
        const free = bx > 0 && by > 0 && bx < W - 1 && by < H - 1 && this.tiles[idx] === T.FLOOR &&
          !this.items[idx] && !this.bombMap.has(idx) && !this.flameT[idx] &&
          !this.players.some(o => o.alive && overlapTiles(o.x, o.y).includes(idx));
        if (!free) { ok = false; break; }
        this.tiles[idx] = T.BLOCK; this.mapVer++;
        this.ev('abil', p.slot, id, bx, by);
        break;
      }
      case 'ghost':
        p.ghost = secs(3);
        this.ev('abil', p.slot, id, tx, ty);
        break;
      case 'detonator': {
        const mine = this.bombs.filter(b => b.owner === p.slot);
        if (!mine.length) { ok = false; break; }
        for (const b of mine) b.fuse = 0;
        this.ev('abil', p.slot, id, tx, ty);
        break;
      }
      case 'frost': {
        for (const o of this.players) {
          if (!o.alive || !this.isEnemy(p, o)) continue;
          if (Math.hypot(o.x - p.x, o.y - p.y) <= 2.6) { o.frozen = RULES.frozen; this.ev('frozen', o.slot); }
        }
        this.ev('abil', p.slot, id, Math.round(p.x * 100), Math.round(p.y * 100));
        break;
      }
      default: ok = false;
    }
    if (ok) p.abilityCd = ab.cd;
    else this.ev('fail', p.slot);
  }

  // ---------------------------------------------------------------- bombas
  tickBombs() {
    if (!this.bombs.length) return;
    const step = RULES.kickSpeed / TICK_RATE;
    for (const b of this.bombs) {
      if (!b.slide) continue;
      const from = Math.floor(b.y) * W + Math.floor(b.x);
      const blocked = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return true;
        const idx = y * W + x;
        const t = this.tiles[idx];
        if (t !== T.FLOOR) return true;
        const o = this.bombMap.get(idx);
        if (o && o !== b) return true;
        return this.players.some(p => p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y);
      };
      const m = moveStep(b, b.slide, step, blocked);
      if (m <= 0.0001) { b.slide = 0; b.x = Math.floor(b.x) + 0.5; b.y = Math.floor(b.y) + 0.5; }
      const to = Math.floor(b.y) * W + Math.floor(b.x);
      if (to !== from) { this.bombMap.delete(from); this.bombMap.set(to, b); }
    }
    for (const b of this.bombs) {
      b.fuse--;
      const idx = Math.floor(b.y) * W + Math.floor(b.x);
      if (this.flameT[idx] > 0) b.fuse = 0;
    }
    const queue = this.bombs.filter(b => b.fuse <= 0);
    const done = new Set();
    while (queue.length) {
      const b = queue.shift();
      if (done.has(b)) continue;
      done.add(b);
      this.explode(b, queue, done);
    }
    if (done.size) {
      this.bombs = this.bombs.filter(b => !done.has(b));
      this.bombMap = new Map(this.bombs.map(b => [Math.floor(b.y) * W + Math.floor(b.x), b]));
    }
  }

  explode(b, queue, done) {
    const tx = Math.floor(b.x), ty = Math.floor(b.y);
    const c = ty * W + tx;
    this.bombMap.delete(c);
    this.setFlame(c, 16, b.owner);
    this.ev('boom', tx, ty, b.fire);
    for (let dir = 1; dir <= 4; dir++) {
      let prev = c;
      for (let r = 1; r <= b.fire; r++) {
        const x = tx + DX[dir] * r, y = ty + DY[dir] * r;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const idx = y * W + x;
        const t = this.tiles[idx];
        if (t === T.WALL || t === T.FALL) break;
        if (t === T.BLOCK || t === T.BURN) {
          this.flame[prev] |= bit(dir);
          if (t === T.BLOCK) { this.tiles[idx] = T.BURN; this.burnT[idx] = RULES.burn; this.mapVer++; }
          if (!b.pierce) break;
          prev = idx;
          continue;
        }
        const o = this.bombMap.get(idx);
        if (o && !done.has(o)) {
          this.flame[prev] |= bit(dir);
          this.setFlame(idx, bit(OPP[dir]), b.owner);
          o.fuse = 0;
          queue.push(o);
          break;
        }
        this.flame[prev] |= bit(dir);
        this.setFlame(idx, bit(OPP[dir]), b.owner);
        if (this.items[idx]) {
          this.items[idx] = 0; this.itemVal[idx] = 0; this.itemsVer++;
          this.ev('burnitem', x, y);
          break;
        }
        prev = idx;
      }
    }
  }

  setFlame(idx, mask, owner) {
    this.flame[idx] |= mask;
    this.flameT[idx] = RULES.flame;
    this.flameOwner[idx] = owner;
  }

  // ----------------------------------------------------------------- daño
  damage() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const idx = Math.floor(p.y) * W + Math.floor(p.x);
      if (this.flameT[idx] > 0) this.hit(p, this.flameOwner[idx]);
    }
  }

  hit(p, by) {
    if (p.invuln > 0) return;
    const killer = this.bySlot.get(by);
    if (killer && killer !== p && this.modeId === 'teams' && !this.settings.friendlyFire && killer.team === p.team) return;
    if (p.shield) {
      p.shield = false;
      p.invuln = RULES.shieldInvuln;
      this.ev('shield', p.slot);
      return;
    }
    this.kill(p, by);
  }

  kill(p, by) {
    p.alive = false;
    p.deaths++;
    p.moving = false;
    const killer = this.bySlot.get(by);
    if (killer && killer !== p) {
      if (this.isEnemy(killer, p)) killer.kills++;
      if (this.modeId === 'chaos') killer.score++;
    } else if (killer === p && this.modeId === 'chaos') {
      p.score--;
    }
    this.scoreVer++;
    this.ev('die', p.slot, killer ? killer.slot : -1);
    if (this.mode.respawn) {
      p.respawnT = RULES.respawn;
      if (this.modeId === 'loot') this.dropCoins(p);
      else this.dropPowerups(p);
    }
  }

  freeTilesNear(tx, ty, max, radius = 3) {
    const out = [];
    const start = ty * W + tx;
    const seen = new Uint8Array(N); seen[start] = 1;
    const q = [[start, 0]];
    while (q.length && out.length < max) {
      const [i, d] = q.shift();
      if (this.tiles[i] === T.FLOOR && !this.items[i] && !this.bombMap.has(i) && !this.flameT[i]) out.push(i);
      if (d >= radius) continue;
      for (let k = 1; k <= 4; k++) {
        const x = (i % W) + DX[k], y = ((i / W) | 0) + DY[k];
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const j = y * W + x;
        if (seen[j] || this.tiles[j] === T.WALL || this.tiles[j] === T.FALL) continue;
        seen[j] = 1; q.push([j, d + 1]);
      }
    }
    return shuffle(out, this.rand);
  }

  dropCoins(p) {
    const lost = Math.ceil(p.score / 2);
    if (lost <= 0) return;
    p.score -= lost;
    const spots = this.freeTilesNear(Math.floor(p.x), Math.floor(p.y), Math.min(4, lost));
    if (!spots.length) return;
    let left = lost;
    spots.forEach((idx, i) => {
      const v = i === spots.length - 1 ? left : Math.max(1, Math.round(lost / spots.length));
      if (v <= 0) return;
      left -= v;
      this.items[idx] = ITEM.COIN; this.itemVal[idx] = v;
    });
    this.itemsVer++;
  }

  dropPowerups(p) {
    const drops = [];
    for (let i = RULES.baseBombs; i < p.bombs; i++) drops.push(ITEM.BOMB);
    for (let i = RULES.baseFire; i < Math.min(p.fire, 6); i++) drops.push(ITEM.FIRE);
    for (let i = 0; i < p.speedLvl; i++) drops.push(ITEM.SPEED);
    if (p.kick) drops.push(ITEM.KICK);
    if (p.pierce) drops.push(ITEM.PIERCE);
    shuffle(drops, this.rand);
    const n = Math.min(2, drops.length);
    if (!n) return;
    const spots = this.freeTilesNear(Math.floor(p.x), Math.floor(p.y), n);
    spots.forEach((idx, i) => { this.items[idx] = drops[i]; });
    this.itemsVer++;
  }

  respawn(p) {
    const enemies = this.players.filter(o => o.alive && o !== p);
    const bombs = this.bombs.map(b => ({ idx: Math.floor(b.y) * W + Math.floor(b.x), fuse: b.fuse, fire: b.fire, pierce: b.pierce }));
    const danger = dangerMap(this.tiles, bombs, this.flameT);
    let best = null, bestScore = -Infinity;
    const consider = (x, y, bonus) => {
      const idx = y * W + x;
      if (this.tiles[idx] !== T.FLOOR || this.bombMap.has(idx) || danger.start[idx] !== Infinity) return;
      let d = 20;
      for (const o of enemies) d = Math.min(d, Math.abs(o.x - x - 0.5) + Math.abs(o.y - y - 0.5));
      const s = d + bonus + this.rand() * 0.5;
      if (s > bestScore) { bestScore = s; best = [x, y]; }
    };
    for (const [x, y] of SPAWNS) consider(x, y, 2);
    if (!best) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) consider(x, y, 0);
    if (!best) { p.respawnT = 10; return; }
    this.resetPlayer(p);
    p.x = best[0] + 0.5; p.y = best[1] + 0.5;
    p.alive = true;
    p.invuln = RULES.spawnInvuln;
    p.dir = 3;
    this.ev('respawn', p.slot);
  }

  // -------------------------------------------------------- muerte súbita
  suddenOrder() {
    if (this._spiral) return this._spiral;
    const out = [];
    let x0 = 1, y0 = 1, x1 = W - 2, y1 = H - 2;
    while (x0 <= x1 && y0 <= y1) {
      for (let x = x0; x <= x1; x++) out.push(y0 * W + x);
      for (let y = y0 + 1; y <= y1; y++) out.push(y * W + x1);
      if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) out.push(y1 * W + x);
      if (x1 > x0) for (let y = y1 - 1; y > y0; y--) out.push(y * W + x0);
      x0++; y0++; x1--; y1--;
    }
    this._spiral = out;
    return out;
  }

  tickSudden() {
    if (this.tick % RULES.suddenEvery !== 0) return;
    const order = this.suddenOrder();
    while (this.suddenIdx < order.length) {
      const idx = order[this.suddenIdx++];
      if (this.tiles[idx] === T.WALL) continue;
      this.tiles[idx] = T.FALL;
      this.items[idx] = 0; this.hidden[idx] = 0; this.burnT[idx] = 0; this.flameT[idx] = 0; this.flame[idx] = 0;
      const b = this.bombMap.get(idx);
      if (b) { this.bombs = this.bombs.filter(o => o !== b); this.bombMap.delete(idx); }
      this.mapVer++; this.itemsVer++;
      const x = idx % W, y = (idx / W) | 0;
      this.ev('fall', x, y);
      for (const p of this.players) {
        if (!p.alive) continue;
        if (Math.floor(p.x) === x && Math.floor(p.y) === y) this.kill(p, -1);
        else if (overlapTiles(p.x, p.y).includes(idx)) { p.x = Math.floor(p.x) + 0.5; p.y = Math.floor(p.y) + 0.5; }
      }
      break;
    }
  }

  // --------------------------------------------------------- reglas de modo
  tickMode() {
    if (this.modeId === 'zone') this.tickZone();
    if (this.modeId === 'loot') {
      if (--this.coinT <= 0) {
        this.coinT = secs(3);
        let visible = 0;
        for (let i = 0; i < N; i++) if (this.items[i] === ITEM.COIN) visible++;
        if (visible < 10) this.spawnCoin();
      }
    }
    if (this.mode.respawn && --this.regenT <= 0) {
      this.regenT = secs(10);
      this.regenBlocks();
    }
  }

  randomFreeTile(minDist = 0) {
    const alive = this.players.filter(p => p.alive);
    for (let tries = 0; tries < 80; tries++) {
      const x = 1 + Math.floor(this.rand() * (W - 2)), y = 1 + Math.floor(this.rand() * (H - 2));
      const idx = y * W + x;
      if (this.tiles[idx] !== T.FLOOR || this.items[idx] || this.bombMap.has(idx) || this.flameT[idx]) continue;
      if (alive.some(p => Math.abs(p.x - x - 0.5) + Math.abs(p.y - y - 0.5) < minDist)) continue;
      return idx;
    }
    return -1;
  }

  spawnCoin() {
    const idx = this.randomFreeTile(1);
    if (idx < 0) return;
    this.items[idx] = ITEM.COIN; this.itemVal[idx] = 1; this.itemsVer++;
  }

  regenBlocks() {
    if (this.countBlocks() >= this.initialBlocks * 0.35) return;
    const rate = POWERUP_RATES[this.settings.powerups];
    let added = 0;
    for (let tries = 0; tries < 40 && added < 8; tries++) {
      const idx = this.randomFreeTile(3);
      if (idx < 0) break;
      const x = idx % W, y = (idx / W) | 0;
      if (SPAWNS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2)) continue;
      if (this.modeId === 'zone' && this.zone && Math.abs(x - this.zone.cx) <= 1 && Math.abs(y - this.zone.cy) <= 1) continue;
      this.tiles[idx] = T.BLOCK;
      this.hideItem(idx, rate);
      added++;
    }
    if (added) { this.mapVer++; this.ev('regen'); }
  }

  tickZone() {
    const z = this.zone;
    const inside = this.players.filter(p => p.alive && Math.abs(Math.floor(p.x) - z.cx) <= 1 && Math.abs(Math.floor(p.y) - z.cy) <= 1);
    if (inside.length === 1) {
      const h = inside[0];
      z.holder = h.slot;
      h.zoneTicks++;
      if (h.zoneTicks % TICK_RATE === 0) { h.score++; this.scoreVer++; }
    } else z.holder = inside.length ? -2 : -1;
    if (--z.moveT <= 0) {
      this.zonePos = (this.zonePos + 1) % this.zoneOrder.length;
      const [cx, cy] = ZONES[this.zoneOrder[this.zonePos]];
      z.cx = cx; z.cy = cy; z.moveT = secs(20);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const idx = (cy + dy) * W + cx + dx;
        if (this.tiles[idx] === T.BLOCK) { this.tiles[idx] = T.BURN; this.burnT[idx] = RULES.burn; this.mapVer++; }
      }
      this.ev('zone', cx, cy);
    }
  }

  // ------------------------------------------------------------ fin de ronda
  checkEnd() {
    if (this.mode.timed) {
      let reached = false;
      if (this.modeId === 'zone') reached = this.players.some(p => !p.left && p.score >= this.settings.zoneTarget);
      if (this.timeLeft > 0) this.timeLeft--;
      const humansLeft = this.players.filter(p => !p.left).length;
      if (reached || this.timeLeft <= 0 || humansLeft < 2) this.finishMatchTimed();
      return;
    }
    const alive = this.players.filter(p => p.alive);
    if (!this.endPending) {
      const done = this.modeId === 'teams' ? new Set(alive.map(p => p.team)).size <= 1 : alive.length <= 1;
      if (done) this.endPending = RULES.roundEndGrace;
      return;
    }
    if (--this.endPending > 0) return;
    let winner = -1, team = -1;
    if (this.modeId === 'teams') {
      const teams = new Set(alive.map(p => p.team));
      if (teams.size === 1) {
        team = [...teams][0];
        this.teamWins[team]++;
        for (const p of this.players) if (p.team === team && !p.left) p.wins++;
        if (this.teamWins[team] >= this.settings.rounds) this.matchOver = true;
      }
    } else if (alive.length === 1) {
      winner = alive[0].slot;
      alive[0].wins++;
      if (alive[0].wins >= this.settings.rounds) this.matchOver = true;
    }
    const remaining = this.players.filter(p => !p.left);
    if (remaining.length < 2 || (this.modeId === 'teams' && new Set(remaining.map(p => p.team)).size < 2)) this.matchOver = true;
    this.lastWinner = winner;
    this.scoreVer++;
    this.phase = 'roundEnd';
    this.phaseT = RULES.roundOver;
    this.ev('rend', winner, team, this.matchOver ? 1 : 0);
  }

  finishMatchTimed() {
    const ranking = this.ranking();
    const top = ranking[0];
    const tie = ranking[1] && ranking[1].score === top.score;
    this.matchOver = true;
    this.phase = 'roundEnd';
    this.phaseT = RULES.roundOver;
    this.scoreVer++;
    this.ev('rend', tie ? -1 : top.slot, -1, 1);
  }

  ranking() {
    const list = this.players.slice();
    if (this.mode.timed) list.sort((a, b) => (a.left - b.left) || b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    else list.sort((a, b) => (a.left - b.left) || b.wins - a.wins || b.kills - a.kills || a.deaths - b.deaths);
    return list;
  }

  results() {
    const r = this.ranking();
    let winnerTeam = -1;
    if (this.modeId === 'teams') winnerTeam = this.teamWins[0] === this.teamWins[1] ? -1 : this.teamWins[0] > this.teamWins[1] ? 0 : 1;
    return {
      mode: this.modeId,
      teamWins: this.teamWins.slice(),
      winnerTeam,
      rows: r.map(p => ({ slot: p.slot, score: p.score, wins: p.wins, kills: p.kills, deaths: p.deaths, left: p.left })),
    };
  }

  // ------------------------------------------------------------ instantánea
  // prev: versiones enviadas en la instantánea anterior (null = instantánea completa)
  snapshot(prev) {
    const s = {
      k: this.tick, ph: PHASES.indexOf(this.phase), pt: this.phaseT, tl: this.timeLeft, r: this.round,
      sd: this.sudden ? 1 : 0,
    };
    if (!prev || prev.mapVer !== this.mapVer) {
      let str = '';
      for (let i = 0; i < N; i++) str += String.fromCharCode(48 + this.tiles[i]);
      s.m = str; s.mid = this.mapId;
    }
    if (!prev || prev.itemsVer !== this.itemsVer) {
      const it = [];
      for (let i = 0; i < N; i++) if (this.items[i]) it.push(i, this.items[i], this.itemVal[i]);
      s.it = it;
    }
    if (!prev || prev.scoreVer !== this.scoreVer) {
      s.sc = this.players.map(p => [p.slot, p.score, p.wins, p.kills, p.deaths, p.left ? 1 : 0]);
      s.tw = this.teamWins.slice();
    }
    s.p = this.players.map(p => {
      let f = 0;
      if (p.alive) f |= PF.ALIVE;
      if (p.moving) f |= PF.MOVING;
      if (p.invuln > 0) f |= PF.INVULN;
      if (p.shield) f |= PF.SHIELD;
      if (p.ghost > 0) f |= PF.GHOST;
      if (p.frozen > 0) f |= PF.FROZEN;
      if (p.kick) f |= PF.KICK;
      if (p.pierce) f |= PF.PIERCE;
      if (p.left) f |= PF.LEFT;
      if (p.barrier > 0) f |= PF.BARRIER;
      return [p.slot, Math.round(p.x * 100), Math.round(p.y * 100), p.dir, f, p.ack,
        p.bombs | 0, p.fire | 0, p.speedLvl | 0, p.abilityCd | 0, p.curse ? CURSES.indexOf(p.curse) + 1 : 0,
        p.respawnT | 0, p.ghost | 0];
    });
    s.b = this.bombs.map(b => [b.id, Math.round(b.x * 100), Math.round(b.y * 100), b.fuse, b.owner, b.slide]);
    const f = [], bu = [];
    for (let i = 0; i < N; i++) {
      if (this.flameT[i]) f.push(i, this.flame[i], this.flameT[i]);
      if (this.burnT[i]) bu.push(i, this.burnT[i]);
    }
    s.f = f; s.bu = bu;
    if (this.zone) s.z = [this.zone.cx, this.zone.cy, this.zone.holder, this.zone.moveT];
    return s;
  }
  versions() { return { mapVer: this.mapVer, itemsVer: this.itemsVer, scoreVer: this.scoreVer }; }
}

// Controlador de la aplicación: pantallas, menús y flujo de salas.
import {
  VERSION, COLORS, ABILITIES, ABILITY_IDS, MODES, MODE_IDS, MAPS, MAP_IDS, ITEMS, ITEM, BOT_LEVELS,
  DEFAULT_SETTINGS, TICK_MS, TEAM_NAMES, TEAM_COLORS, W, H, MAX_PLAYERS,
} from './data.js';
import { CONFIG } from './config.js';
import { HostNet, ClientNet, Browser, refToPeerId, friendlyError, peerAvailable } from './net.js';
import { HostRoom, ClientRoom } from './session.js';
import { GameClient } from './game.js';
import { Input } from './input.js';
import { sound } from './audio.js';
import { icon } from './icons.js';
import { Sim, PF } from './sim.js';
import { Bot, BOT_ABILITIES } from './bots.js';
import { Renderer } from './render.js';
import { cleanName, cleanText, randomCode, normalizeCode, mulberry32 } from './util.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ----------------------------------------------------------------- preferencias
const PREF_KEY = 'bomber.prefs.v1';
const prefs = Object.assign({
  name: '', color: Math.floor(Math.random() * COLORS.length), ability: 'dash',
  sfx: 70, musicVol: 30, music: true, shake: true, touch: 'auto',
}, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })());
if (!ABILITY_IDS.includes(prefs.ability)) prefs.ability = 'dash';
if (!(prefs.color >= 0 && prefs.color < COLORS.length)) prefs.color = 0;
prefs.name = cleanName(prefs.name);
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* modo privado */ } };
const applySound = () => sound.setVolumes(prefs.sfx / 100, (prefs.musicVol / 100) * 0.6);
applySound();
sound.musicOn = false;

function profile() {
  return { name: prefs.name || 'Jugador', color: prefs.color, ability: prefs.ability };
}

// ------------------------------------------------------------------ utilidades UI
let toastT;
function toast(text, error = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = 'toast'; }, error ? 5200 : 3200);
}

let current = 'menu';
function show(name) {
  current = name;
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === `screen-${name}`);
  if (name === 'menu') demo.start(); else demo.stop();
  if (name !== 'browse') stopBrowse();
}

let cancelConnect = null;
function connecting(text, onCancel) {
  $('#connectingText').textContent = text;
  $('#connecting').hidden = false;
  cancelConnect = onCancel || null;
}
function doneConnecting() { $('#connecting').hidden = true; cancelConnect = null; }
$('#btnCancelConnect').addEventListener('click', () => { const f = cancelConnect; doneConnecting(); if (f) f(); });

function avatar(colorIdx, size = 34) {
  const c = COLORS[colorIdx % COLORS.length].hex;
  return `<svg class="pl-av" viewBox="0 0 34 34" width="${size}" height="${size}" aria-hidden="true">
    <ellipse cx="17" cy="31" rx="10" ry="2.5" fill="rgba(0,0,0,.35)"/>
    <circle cx="17" cy="16" r="13" fill="#1d2027"/><circle cx="17" cy="16" r="11.5" fill="${c}"/>
    <rect x="15.3" y="1.5" width="3.4" height="4.5" rx="1.5" fill="#1d2027"/>
    <rect x="8.5" y="11.5" width="17" height="7" rx="3.4" fill="#1b1f2a"/>
    <rect x="11.5" y="13.3" width="2.6" height="3.4" fill="#8ff6ff"/><rect x="19.5" y="13.3" width="2.6" height="3.4" fill="#8ff6ff"/>
  </svg>`;
}

// ------------------------------------------------------------------ menú principal
function buildPicker(root, kind, small = false, onPick) {
  root.textContent = '';
  if (kind === 'color') {
    COLORS.forEach((c, i) => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.style.setProperty('--c', c.hex);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      b.dataset.v = String(i);
      b.addEventListener('click', () => onPick(i));
      root.appendChild(b);
    });
  } else {
    for (const id of ABILITY_IDS) {
      const b = el('button', 'ab');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.v = id;
      b.innerHTML = `${icon(id)}<span></span>`;
      b.querySelector('span').textContent = ABILITIES[id].name;
      b.title = ABILITIES[id].desc;
      b.addEventListener('click', () => onPick(id));
      root.appendChild(b);
    }
  }
  void small;
}
function markPicker(root, value, disabled = new Set()) {
  for (const b of root.children) {
    const v = b.dataset.v;
    const on = String(v) === String(value);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    b.disabled = disabled.has(v) && !on;
  }
}

function initMenu() {
  const name = $('#name');
  name.value = prefs.name;
  name.addEventListener('input', () => { prefs.name = cleanName(name.value); savePrefs(); });
  const colors = $('#colors');
  buildPicker(colors, 'color', false, i => { prefs.color = i; savePrefs(); markPicker(colors, i); demo.recolor(); });
  markPicker(colors, prefs.color);
  const abil = $('#abilities');
  const desc = $('#abilityDesc');
  const pickAb = id => { prefs.ability = id; savePrefs(); markPicker(abil, id); desc.textContent = ABILITIES[id].desc; };
  buildPicker(abil, 'ability', false, pickAb);
  pickAb(prefs.ability);

  $('#btnQuick').addEventListener('click', quickPlay);
  $('#btnBrowse').addEventListener('click', openBrowse);
  $('#btnCreate').addEventListener('click', () => openCreate());
  $('#btnJoin').addEventListener('click', () => { $('#joinCode').value = ''; $('#dlgJoin').showModal(); });
  $('#btnPractice').addEventListener('click', practice);
  $('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
  $('#btnSettings').addEventListener('click', () => $('#dlgSettings').showModal());
  for (const b of $$('[data-back]')) b.addEventListener('click', () => show('menu'));
  $('#btnRefresh').addEventListener('click', scanRooms);
  $('#btnCreatePublic').addEventListener('click', () => openCreate(true));

  // crear sala
  const sel = $('#createMode');
  for (const id of MODE_IDS) { const o = el('option', null, MODES[id].name); o.value = id; sel.appendChild(o); }
  for (const r of $$('input[name=vis]')) r.addEventListener('change', () => {
    $('#visHint').textContent = r.value === 'public' && r.checked ? 'Aparece en la lista de salas y en la partida rápida.' : 'Solo entra quien tenga el código o el enlace.';
  });
  $('#dlgCreate').addEventListener('close', () => {
    if ($('#dlgCreate').returnValue !== 'ok') return;
    const isPublic = $('input[name=vis]:checked').value === 'public';
    createRoom({ isPublic, name: $('#roomNameInput').value, settings: { ...DEFAULT_SETTINGS, mode: sel.value } });
  });
  // unirse
  const code = $('#joinCode');
  code.addEventListener('input', () => { code.value = normalizeCode(code.value); });
  $('#dlgJoin').addEventListener('close', () => {
    if ($('#dlgJoin').returnValue !== 'ok') return;
    const ref = normalizeCode(code.value);
    if (ref) joinRef(ref);
  });

  // ajustes
  for (const inp of $$('[data-pref]')) {
    const k = inp.dataset.pref;
    const sync = () => {
      if (inp.type === 'checkbox') inp.checked = !!prefs[k];
      else inp.value = String(prefs[k]);
    };
    sync();
    inp.addEventListener('input', () => {
      prefs[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value;
      savePrefs();
      applySound();
      for (const other of $$(`[data-pref=${k}]`)) if (other !== inp) { if (other.type === 'checkbox') other.checked = !!prefs[k]; else other.value = String(prefs[k]); }
      if (k === 'music' && game) sound.setMusic(prefs.music);
      if (k === 'shake' && game) game.renderer.shakeOn = prefs.shake;
      if (k === 'sfx') sound.play('click', 1);
    });
  }

  // ayuda
  const modes = $('#helpModes');
  for (const id of MODE_IDS) {
    const li = el('li');
    li.appendChild(el('b', null, `${MODES[id].name}. `));
    li.appendChild(document.createTextNode(MODES[id].desc));
    modes.appendChild(li);
  }
  const itemBg = { 1: '#4656d8', 2: '#f0561f', 3: '#18a865', 4: '#b8742c', 5: '#7a4bd6', 6: '#1f9fc4', 7: '#d8203a', 8: '#3b2348' };
  const items = $('#helpItems');
  for (const k of [ITEM.BOMB, ITEM.FIRE, ITEM.SPEED, ITEM.KICK, ITEM.PIERCE, ITEM.SHIELD, ITEM.MAXFIRE, ITEM.SKULL]) {
    const it = ITEMS[k];
    const li = el('li');
    const ic = el('span', 'chipicon');
    ic.style.setProperty('--bg', itemBg[k]);
    ic.innerHTML = icon(it.key);
    li.appendChild(ic);
    const t = el('span');
    t.appendChild(el('b', null, `${it.name}. `));
    t.appendChild(document.createTextNode(it.desc));
    li.appendChild(t);
    items.appendChild(li);
  }
  const abs = $('#helpAbilities');
  for (const id of ABILITY_IDS) {
    const li = el('li');
    const ic = el('span', 'chipicon');
    ic.innerHTML = icon(id);
    li.appendChild(ic);
    const t = el('span');
    t.appendChild(el('b', null, `${ABILITIES[id].name}. `));
    t.appendChild(document.createTextNode(`${ABILITIES[id].desc} Recarga: ${Math.round(ABILITIES[id].cd * TICK_MS / 1000)} s.`));
    li.appendChild(t);
    abs.appendChild(li);
  }
}

// ------------------------------------------------------- escenario del menú (bots jugando)
const demo = {
  canvas: null, renderer: null, sim: null, bots: [], raf: 0, running: false, acc: 0, last: 0, dying: new Map(),
  init() {
    this.canvas = $('#demo');
    this.renderer = new Renderer(this.canvas);
    this.renderer.shakeOn = false;
    this.fit = () => this.layout();
    window.addEventListener('resize', this.fit);
  },
  newMatch() {
    const n = 5;
    const seed = (Math.random() * 1e9) | 0;
    const rand = mulberry32(seed);
    const used = new Set([prefs.color]);
    const roster = [];
    for (let i = 0; i < n; i++) {
      let c = i === 0 ? prefs.color : Math.floor(rand() * COLORS.length);
      while (i > 0 && used.has(c)) c = (c + 1) % COLORS.length;
      used.add(c);
      roster.push({ slot: i, id: `d${i}`, name: '', color: c, team: 0, ability: BOT_ABILITIES[i % BOT_ABILITIES.length], bot: true });
    }
    this.sim = new Sim({ settings: { mode: 'chaos', map: 'random', matchTime: 240, powerups: 'muchos' }, roster, seed });
    this.sim.phase = 'play';
    this.bots = roster.map(r => new Bot(r.slot, 'hard', rand));
    this.view = null;
    this.dying.clear();
  },
  recolor() { if (this.sim) { const p = this.sim.players[0]; if (p) p.color = prefs.color; } },
  layout() {
    const vh = window.innerHeight, vw = window.innerWidth;
    const narrow = vw < 760;
    const h = narrow ? vh * 1.1 : Math.min(vh * 0.9, ((vw - 470) * H) / W * 0.92);
    this.renderer.resize((h * W) / H, h);
    const cw = parseFloat(this.canvas.style.width) || (h * W) / H;
    const cx = narrow ? vw / 2 : 430 + Math.max(0, vw - 430) / 2;
    Object.assign(this.canvas.style, { left: `${cx - cw / 2}px`, top: '50%', transform: 'translateY(-50%) rotate(-2.5deg)' });
  },
  start() {
    if (this.running) return;
    if (!this.sim || this.sim.phase === 'over') this.newMatch();
    this.running = true;
    this.layout();
    this.last = performance.now();
    const loop = now => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt * 1000;
      let n = 0;
      while (this.acc >= TICK_MS && n < 4) { this.step(); this.acc -= TICK_MS; n++; }
      if (n === 4) this.acc = 0;
      this.draw(now, dt, this.acc / TICK_MS);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  stop() { this.running = false; cancelAnimationFrame(this.raf); },
  step() {
    const sim = this.sim;
    for (const p of sim.players) { p.px = p.x; p.py = p.y; }
    const inputs = new Map();
    for (const b of this.bots) inputs.set(b.slot, b.input(sim));
    sim.step(inputs);
    for (const e of sim.drainEvents()) {
      if (e[0] === 'die') { this.dying.set(e[1], 0); const p = sim.bySlot.get(e[1]); this.renderer.burst(p.x, p.y, 12, { colors: [COLORS[p.color].hex, '#fff'], speed: 3, life: 0.6, size: 0.1, grav: 6 }); }
      if (e[0] === 'boom') this.renderer.burst(e[1] + 0.5, e[2] + 0.5, 5, { colors: ['rgba(60,60,64,.5)'], type: 'smoke', speed: 1, life: 0.7, size: 0.2 });
      if (e[0] === 'respawn') this.dying.delete(e[1]);
    }
    if (sim.phase !== 'play') this.newMatch();
  },
  draw(now, dt, alpha) {
    const sim = this.sim;
    if (!this.view || this.view.mapVer !== sim.mapVer) {
      let key = '';
      for (let i = 0; i < sim.tiles.length; i++) key += String.fromCharCode(48 + sim.tiles[i]);
      this.view = { mapVer: sim.mapVer, tilesKey: key };
    }
    const itemList = [];
    for (let i = 0; i < sim.items.length; i++) if (sim.items[i]) itemList.push(i, sim.items[i], sim.itemVal[i]);
    const flames = [];
    const burns = new Map();
    for (let i = 0; i < sim.flameT.length; i++) {
      if (sim.flameT[i]) flames.push(i, sim.flame[i], sim.flameT[i]);
      if (sim.burnT[i]) burns.set(i, sim.burnT[i]);
    }
    const players = sim.players.map(p => {
      let d = this.dying.has(p.slot) ? this.dying.get(p.slot) : -1;
      if (d >= 0) { d += dt; this.dying.set(p.slot, d); }
      let flags = 0;
      if (p.alive) flags |= PF.ALIVE;
      if (p.invuln > 0) flags |= PF.INVULN;
      if (p.shield) flags |= PF.SHIELD;
      if (p.ghost > 0) flags |= PF.GHOST;
      if (p.frozen > 0) flags |= PF.FROZEN;
      if (p.barrier > 0) flags |= PF.BARRIER;
      const ax = p.px ?? p.x, ay = p.py ?? p.y;
      const jump = Math.abs(ax - p.x) + Math.abs(ay - p.y) > 1;
      return {
        slot: p.slot, color: p.color, team: 0, name: '', x: jump ? p.x : ax + (p.x - ax) * alpha, y: jump ? p.y : ay + (p.y - ay) * alpha,
        dir: p.dir, moving: p.moving, flags, curse: p.curse, dying: p.alive ? -1 : d, visible: p.alive || (d >= 0 && d < 0.8), isMe: false, noTag: true,
      };
    });
    this.renderer.draw({
      mapId: sim.mapId, tiles: sim.tiles, tilesKey: this.view.tilesKey, itemList, flames, burns, zone: null,
      bombs: sim.bombs.map(b => ({ x: b.x, y: b.y, fuse: b.fuse, owner: b.owner })), players, teams: false,
    }, now, dt);
  },
};

function openCreate(isPublic = true) {
  const name = $('#roomNameInput');
  name.value = '';
  name.placeholder = `Sala de ${profile().name}`;
  const radio = $(`input[name=vis][value=${isPublic ? 'public' : 'private'}]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  $('#dlgCreate').returnValue = '';
  $('#dlgCreate').showModal();
}

// ------------------------------------------------------------------ red y salas
let room = null;
let game = null;
let browser = null;
const input = new Input();
input.enabled = false;

function bindRoom(r) {
  room = r;
  let ready = false;
  const settle = () => { if (!ready) { ready = true; doneConnecting(); } };
  r.on('state', s => { settle(); renderLobby(s); if (current !== 'lobby' && current !== 'game') show('lobby'); });
  r.on('chat', msg => { addChat(msg); if (game) game.chatLine(msg); if (!msg.sys && msg.id !== r.selfId) sound.play('click', 0.6); });
  r.on('start', data => { settle(); startGame(data); });
  r.on('snap', s => { if (game) game.applySnapshot(s); });
  r.on('roster', list => { if (game) game.setRoster(list); });
  r.on('end', res => { if (game) game.showResults(res); });
  r.on('lobby', () => { endGame(); show('lobby'); if (r.state) renderLobby(r.state, true); });
  r.on('notice', text => toast(text));
  r.on('closed', ({ reason }) => {
    const msg = {
      host: 'El anfitrión ha cerrado la sala.', kicked: 'El anfitrión te ha expulsado de la sala.',
      full: 'La sala está llena.', version: 'La sala usa otra versión de Bomber. Recarga la página.',
      lost: 'Se ha perdido la conexión con la sala.', timeout: 'La sala ha dejado de responder.',
    }[reason] || 'La sala se ha cerrado.';
    teardown();
    doneConnecting();
    show('menu');
    toast(msg, reason !== 'host');
  });
}

function teardown() {
  endGame();
  room = null;
  chatSeen = 0;
  $('#chatLog').textContent = '';
  lobbyKey = '';
  settingsKey = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function leaveRoom() {
  if (room) room.leave();
  teardown();
  show('menu');
}

async function createRoom({ isPublic, name, settings, quiet = false }) {
  if (!peerAvailable()) { toast('No se pudo cargar la librería de red. Revisa tu conexión.', true); return; }
  let cancelled = false;
  if (!quiet) connecting(isPublic ? 'Abriendo sala pública…' : 'Abriendo sala privada…', () => { cancelled = true; });
  try {
    let code = randomCode(5);
    while (/^P\d/.test(code)) code = randomCode(5);
    const net = await HostNet.create(isPublic, code);
    if (cancelled) { net.destroy(); return; }
    const r = new HostRoom({ net, profile: profile(), settings, name: cleanText(name, 28), isPublic });
    bindRoom(r);
    doneConnecting();
    history.replaceState(null, '', `#/sala/${net.ref}`);
    show('lobby');
    renderLobby(r.state, true);
    if (!quiet) addChat({ sys: true, text: isPublic ? 'Sala pública abierta. Aparecerá en la lista de salas.' : 'Comparte el código o el enlace para que entren tus amigos.' });
  } catch (e) {
    doneConnecting();
    if (!cancelled) toast(e.message || friendlyError(e), true);
  }
}

function practice() {
  const r = new HostRoom({ net: null, profile: profile(), settings: { ...DEFAULT_SETTINGS, botLevel: 'normal' }, name: 'Práctica', isPublic: false });
  bindRoom(r);
  r.addBot(); r.addBot(); r.addBot();
  show('lobby');
  renderLobby(r.state, true);
}

async function joinRef(ref) {
  const peerId = refToPeerId(ref);
  if (!peerId) { toast('Ese código no es válido.', true); return; }
  if (!peerAvailable()) { toast('No se pudo cargar la librería de red. Revisa tu conexión.', true); return; }
  let cancelled = false;
  let net = null;
  connecting(`Entrando en la sala ${ref}…`, () => { cancelled = true; if (net) net.destroy(); if (room && room.role === 'client') { room.leave(); teardown(); } });
  try {
    net = await ClientNet.connect(peerId);
    if (cancelled) { net.destroy(); return; }
    const r = new ClientRoom(net, profile(), ref);
    bindRoom(r);
    history.replaceState(null, '', `#/sala/${ref}`);
    setTimeout(() => {
      if (room === r && !r.state && !game) { r.leave(); teardown(); doneConnecting(); show('menu'); toast('La sala no ha respondido.', true); }
    }, 12000);
  } catch (e) {
    doneConnecting();
    if (!cancelled) {
      toast(e.message || friendlyError(e), true);
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }
  }
}

async function quickPlay() {
  if (!peerAvailable()) { toast('No se pudo cargar la librería de red. Revisa tu conexión.', true); return; }
  let cancelled = false, joined = false;
  connecting('Buscando una sala abierta…', () => { cancelled = true; });
  const good = r => r.ver === VERSION && r.players < r.max;
  const pick = r => {
    if (joined || cancelled || !good(r) || r.phase !== 'lobby') return;
    joined = true;
    joinRef(r.ref);
  };
  try {
    browser = browser || new Browser();
    const rooms = (await browser.scan(pick)) || [];
    if (cancelled || joined) return;
    const ok = rooms.filter(good);
    const open = ok.find(r => r.phase === 'lobby') || ok.find(r => r.phase === 'game' && MODES[r.mode] && MODES[r.mode].respawn);
    if (open) { joined = true; joinRef(open.ref); return; }
    $('#connectingText').textContent = 'No hay salas abiertas. Creando una…';
    await createRoom({ isPublic: true, name: '', settings: { ...DEFAULT_SETTINGS }, quiet: true });
    if (room) addChat({ sys: true, text: 'No había salas abiertas, así que has creado una pública. Espera a que entre alguien o añade bots.' });
  } catch (e) {
    doneConnecting();
    if (!cancelled) toast(e.message || friendlyError(e), true);
  }
}

// ------------------------------------------------------------------ buscar salas
let browseTimer = 0;
function openBrowse() {
  if (!peerAvailable()) { toast('No se pudo cargar la librería de red. Revisa tu conexión.', true); return; }
  show('browse');
  shownRooms = new Map();
  $('#roomList').textContent = '';
  $('#browseEmpty').hidden = true;
  scanRooms();
  clearInterval(browseTimer);
  browseTimer = setInterval(scanRooms, 10000);
}
function stopBrowse() { clearInterval(browseTimer); browseTimer = 0; }

let shownRooms = new Map();
async function scanRooms() {
  const status = $('#browseStatus');
  status.textContent = 'Buscando salas…';
  const found = new Map();
  try {
    browser = browser || new Browser();
    const rooms = await browser.scan(r => {
      found.set(r.ref, r);
      shownRooms.set(r.ref, r);
      if (current === 'browse') renderRooms([...shownRooms.values()], false);
    });
    if (current !== 'browse') return;
    shownRooms = new Map((rooms || [...found.values()]).map(r => [r.ref, r]));
    renderRooms([...shownRooms.values()], true);
    const n = shownRooms.size;
    status.textContent = n ? `${n === 1 ? 'Una sala abierta' : `${n} salas abiertas`}. La lista se actualiza sola.` : '';
  } catch (e) {
    status.textContent = e.message || friendlyError(e);
  }
}

function renderRooms(rooms, final) {
  const list = $('#roomList');
  list.textContent = '';
  $('#browseEmpty').hidden = rooms.length > 0 || !final;
  rooms.sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.players - a.players);
  for (const r of rooms) {
    const li = el('li', `room${r.phase === 'game' ? ' ingame' : ''}`);
    const info = el('div');
    info.appendChild(el('div', 'room-name', r.name || 'Sala'));
    const mode = MODES[r.mode] ? MODES[r.mode].name : '?';
    const map = r.map === 'random' ? 'mapa aleatorio' : MAPS[r.map] ? `mapa ${MAPS[r.map].name}` : '';
    const status = r.ver !== VERSION ? 'otra versión' : r.phase === 'game' ? 'en partida' : 'esperando jugadores';
    info.appendChild(el('div', 'room-meta', `${mode}, ${map}, ${status}`));
    li.appendChild(info);
    li.appendChild(el('div', 'room-count', `${r.players}/${r.max}`));
    const b = el('button', 'btn small', r.phase === 'game' ? 'Entrar a mirar' : 'Entrar');
    if (r.ver !== VERSION) b.disabled = true;
    b.addEventListener('click', () => joinRef(r.ref));
    li.appendChild(b);
    list.appendChild(li);
  }
}

// ------------------------------------------------------------------ sala de espera
let lobbyKey = '';
let settingsKey = '';
let chatSeen = 0;

function myMember(s) {
  const id = room && room.selfId;
  return s.members.find(m => m.id === id);
}

function renderLobby(s, force = false) {
  if (!room || !s) return;
  const isHost = room.role === 'host';
  const local = isHost && room.local;
  const me = myMember(s);
  const key = JSON.stringify([s.members.map(m => [m.id, m.name, m.color, m.ability, m.team, m.ready, m.spectator, m.ping]), s.phase, s.settings.maxPlayers, s.settings.mode, s.settings.abilities]);
  $('#roomName').textContent = s.name;
  $('#roomKind').textContent = local ? 'Práctica sin conexión contra bots' : s.isPublic ? 'Sala pública: aparece en la lista de salas' : 'Sala privada: solo entra quien tenga el código';
  $('#roomCodeBox').hidden = local;
  $('#roomCode').textContent = s.ref;
  $('#chatPanel').hidden = local;

  if (force || key !== lobbyKey) {
    lobbyKey = key;
    renderPlayers(s, isHost, me);
    renderYou(s, isHost, me);
  }
  const skey = JSON.stringify([s.settings, isHost, s.phase]);
  if (force || skey !== settingsKey) { settingsKey = skey; renderSettings(s, isHost); }
  renderStart(s, isHost, me);
}

function renderPlayers(s, isHost, me) {
  const list = $('#playerList');
  list.textContent = '';
  const players = s.members.filter(m => !m.spectator);
  const specs = s.members.filter(m => m.spectator);
  $('#playerCount').textContent = `${players.length} de ${s.settings.maxPlayers}`;
  const teams = MODES[s.settings.mode].teams;
  const row = m => {
    const d = el('div', `pl${me && m.id === me.id ? ' me' : ''}`);
    const av = el('div');
    av.innerHTML = avatar(m.color);
    d.appendChild(av);
    const main = el('div', 'pl-main');
    const nm = el('div', 'pl-name');
    nm.appendChild(document.createTextNode(m.name));
    if (m.id === 'host') { const c = el('span'); c.innerHTML = icon('crown'); c.title = 'Anfitrión'; nm.appendChild(c); }
    main.appendChild(nm);
    const sub = el('div', 'pl-sub');
    if (s.settings.abilities && ABILITIES[m.ability]) {
      const a = el('span');
      a.innerHTML = icon(m.ability);
      a.title = ABILITIES[m.ability].name;
      sub.appendChild(a);
      sub.appendChild(document.createTextNode(ABILITIES[m.ability].name));
    }
    if (m.bot) sub.appendChild(document.createTextNode(` Bot ${BOT_LEVELS[s.settings.botLevel].toLowerCase()}`));
    else if (m.ping && m.id !== room.selfId) sub.appendChild(el('span', null, `${m.ping} ms`));
    main.appendChild(sub);
    d.appendChild(main);
    const side = el('div', 'pl-side');
    if (m.spectator) side.appendChild(el('span', 'state spec', 'Espectador'));
    else if (m.bot) side.appendChild(el('span', 'state ready', 'Bot'));
    else if (m.id === 'host') side.appendChild(el('span', 'state ready', 'Anfitrión'));
    else side.appendChild(el('span', `state${m.ready ? ' ready' : ''}`, m.ready ? 'Listo' : 'Esperando'));
    if (isHost && m.id !== 'host' && (s.phase === 'lobby' || !m.bot)) {
      const k = el('button', 'icon-btn');
      k.type = 'button';
      k.innerHTML = icon('close');
      k.title = m.bot ? `Quitar a ${m.name}` : `Expulsar a ${m.name}`;
      k.setAttribute('aria-label', k.title);
      k.addEventListener('click', () => room.kick(m.id));
      side.appendChild(k);
    }
    d.appendChild(side);
    return d;
  };
  if (teams) {
    for (const t of [0, 1]) {
      const h = el('div', 'team-col-head', TEAM_NAMES[t]);
      h.style.setProperty('--tc', TEAM_COLORS[t]);
      list.appendChild(h);
      for (const m of players.filter(x => x.team === t)) list.appendChild(row(m));
    }
  } else for (const m of players) list.appendChild(row(m));
  const free = s.settings.maxPlayers - players.length;
  for (let i = 0; i < Math.min(free, 3); i++) list.appendChild(el('div', 'pl empty', 'Hueco libre'));
  if (specs.length) { list.appendChild(el('div', 'team-col-head', 'Espectadores')); for (const m of specs) list.appendChild(row(m)); }
  const addBot = $('#btnAddBot');
  addBot.hidden = !isHost || s.phase !== 'lobby';
  addBot.disabled = players.length >= s.settings.maxPlayers;
}

function renderYou(s, isHost, me) {
  if (!me) return;
  const used = new Set(s.members.filter(m => m !== me).map(m => String(m.color)));
  const colors = $('#lobbyColors');
  if (!colors.children.length) buildPicker(colors, 'color', true, i => { prefs.color = i; savePrefs(); room.setSelf({ color: i }); });
  markPicker(colors, me.color, used);
  const abil = $('#lobbyAbilities');
  if (!abil.children.length) buildPicker(abil, 'ability', true, id => { prefs.ability = id; savePrefs(); room.setSelf({ ability: id }); markPicker(abil, id); $('#lobbyAbilityDesc').textContent = ABILITIES[id].desc; });
  markPicker(abil, me.ability);
  abil.hidden = !s.settings.abilities;
  $('#lobbyAbilityDesc').textContent = s.settings.abilities ? ABILITIES[me.ability].desc : 'Las habilidades están desactivadas en esta sala.';
  const tp = $('#teamPick');
  tp.hidden = !MODES[s.settings.mode].teams || me.spectator;
  for (const b of tp.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.team) === me.team));
  const lock = s.phase !== 'lobby';
  for (const b of tp.querySelectorAll('button')) b.disabled = lock;
  if (lock) for (const b of [...colors.children, ...abil.children]) b.disabled = true;
}

function settingField(label, key, options, s, isHost) {
  const f = el('label', 'field');
  f.appendChild(el('span', null, label));
  const cur = s.settings[key];
  if (isHost && s.phase === 'lobby') {
    const sel = el('select');
    for (const [v, t] of options) {
      const o = el('option', null, t);
      o.value = String(v);
      if (String(v) === String(cur)) o.selected = true;
      sel.appendChild(o);
    }
    if (!options.some(([v]) => String(v) === String(cur))) { const o = el('option', null, String(cur)); o.value = String(cur); o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const v = typeof cur === 'number' ? Number(raw) : raw;
      room.updateSettings({ [key]: v });
    });
    f.appendChild(sel);
  } else {
    const found = options.find(([v]) => String(v) === String(cur));
    f.appendChild(el('div', 'ro', found ? found[1] : String(cur)));
  }
  return f;
}

function settingCheck(label, key, s, isHost) {
  const l = el('label', 'check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!s.settings[key];
  c.disabled = !isHost || s.phase !== 'lobby';
  c.addEventListener('change', () => room.updateSettings({ [key]: c.checked }));
  l.appendChild(c);
  l.appendChild(document.createTextNode(label));
  return l;
}

function renderSettings(s, isHost) {
  const modes = $('#modePick');
  if (!modes.children.length) {
    for (const id of MODE_IDS) {
      const b = el('button', 'mode', MODES[id].name);
      b.type = 'button';
      b.dataset.v = id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { if (room && room.role === 'host') room.updateSettings({ mode: id }); });
      modes.appendChild(b);
    }
  }
  for (const b of modes.children) {
    b.setAttribute('aria-checked', String(b.dataset.v === s.settings.mode));
    b.disabled = !isHost || s.phase !== 'lobby';
  }
  $('#modeDesc').textContent = MODES[s.settings.mode].desc;
  $('#settingsNote').textContent = isHost ? '' : 'Lo elige el anfitrión';
  const g = $('#settingsGrid');
  g.textContent = '';
  const m = MODES[s.settings.mode];
  const mmss = v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  g.appendChild(settingField('Mapa', 'map', [['random', 'Aleatorio'], ...MAP_IDS.map(id => [id, MAPS[id].name])], s, isHost));
  g.appendChild(settingField('Jugadores', 'maxPlayers', [2, 3, 4, 5, 6, 7, 8].map(n => [n, `Hasta ${n}`]), s, isHost));
  if (m.rounds) {
    g.appendChild(settingField('Rondas para ganar', 'rounds', [1, 2, 3, 4, 5].map(n => [n, String(n)]), s, isHost));
    g.appendChild(settingField('Muerte súbita a los', 'roundTime', [60, 90, 120, 180, 240].map(n => [n, mmss(n)]), s, isHost));
  } else {
    g.appendChild(settingField('Duración', 'matchTime', [120, 180, 240, 300, 420].map(n => [n, `${n / 60} min`]), s, isHost));
    if (s.settings.mode === 'zone') g.appendChild(settingField('Puntos para ganar', 'zoneTarget', [30, 45, 60, 90, 120].map(n => [n, String(n)]), s, isHost));
  }
  g.appendChild(settingField('Potenciadores', 'powerups', [['pocos', 'Pocos'], ['normal', 'Normal'], ['muchos', 'Muchos']], s, isHost));
  g.appendChild(settingField('Nivel de los bots', 'botLevel', Object.entries(BOT_LEVELS), s, isHost));
  g.appendChild(settingCheck('Habilidades activas', 'abilities', s, isHost));
  if (m.teams) g.appendChild(settingCheck('Fuego amigo', 'friendlyFire', s, isHost));
}

function renderStart(s, isHost, me) {
  const btn = $('#btnReady');
  const note = $('#startNote');
  if (isHost) {
    const why = room.canStart();
    btn.textContent = s.phase === 'game' ? 'Partida en curso' : 'Empezar partida';
    btn.disabled = !!why || s.phase !== 'lobby';
    btn.classList.remove('on');
    note.textContent = s.phase === 'game' ? '' : why || 'Todo listo.';
  } else {
    const ready = !!(me && me.ready);
    btn.disabled = !me || me.spectator || s.phase !== 'lobby';
    btn.textContent = ready ? 'Listo' : 'Estoy listo';
    btn.classList.toggle('on', ready);
    btn.setAttribute('aria-pressed', String(ready));
    note.textContent = s.phase === 'game' ? 'La partida está en curso. Entrarás en la siguiente.'
      : me && me.spectator ? 'La sala está llena: miras como espectador.'
        : ready ? 'Esperando a que el anfitrión empiece.' : 'Pulsa cuando estés preparado.';
  }
}

function addChat(msg) {
  const log = $('#chatLog');
  const d = el('div', msg.sys ? 'sys' : '');
  if (msg.sys) d.textContent = msg.text;
  else {
    const n = el('b', null, `${msg.name}: `);
    n.style.color = COLORS[(msg.color | 0) % COLORS.length].hex;
    d.appendChild(n);
    d.appendChild(document.createTextNode(msg.text));
  }
  log.appendChild(d);
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  chatSeen++;
}

function initLobby() {
  $('#btnLeaveLobby').addEventListener('click', leaveRoom);
  $('#btnAddBot').addEventListener('click', () => { if (room && room.role === 'host' && !room.addBot()) toast('La sala está completa.'); });
  $('#btnReady').addEventListener('click', () => {
    if (!room) return;
    sound.unlock();
    if (room.role === 'host') room.startGame();
    else { const me = myMember(room.state); room.setSelf({ ready: !(me && me.ready) }); }
  });
  for (const b of $$('#teamPick button')) b.addEventListener('click', () => room && room.setSelf({ team: Number(b.dataset.team) }));
  $('#btnCopyLink').addEventListener('click', async () => {
    if (!room || !room.state) return;
    const url = `${location.origin}${location.pathname}#/sala/${room.state.ref}`;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Compártelo con tus amigos.'); }
    catch { window.prompt('Copia este enlace:', url); }
  });
  $('#chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('#chatInput');
    if (room && inp.value.trim()) room.chat(inp.value);
    inp.value = '';
  });
}

// ------------------------------------------------------------------ partida
function startGame(data) {
  endGame();
  show('game');
  sound.unlock();
  const root = $('#screen-game');
  game = new GameClient({
    root, roster: data.roster, settings: data.settings, you: data.you, isHost: room.role === 'host',
    room, input, sound, prefs, snap: data.snap,
  });
  root.querySelector('.tbtn-bomb').innerHTML = icon('bomb');
}

function endGame() {
  if (game) { game.destroy(); game = null; }
}

function initGameUi() {
  $('#btnPause').addEventListener('click', () => game && game.togglePause());
  $('#btnResume').addEventListener('click', () => game && game.togglePause(false));
  let confirmQuit = 0;
  $('#btnQuitGame').addEventListener('click', () => {
    if (room && room.role === 'host' && !room.local && Date.now() - confirmQuit > 3000) {
      confirmQuit = Date.now();
      $('#btnQuitGame').textContent = 'Pulsa otra vez: se cerrará la sala para todos';
      setTimeout(() => { $('#btnQuitGame').textContent = 'Salir de la partida'; }, 3000);
      return;
    }
    leaveRoom();
  });
  $('#resBack').addEventListener('click', () => room && room.role === 'host' && room.backToLobby());
  $('#resLeave').addEventListener('click', leaveRoom);
}

// ------------------------------------------------------------------ arranque
function boot() {
  initMenu();
  initLobby();
  initGameUi();
  demo.init();
  show('menu');
  const unlock = () => { sound.unlock(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('beforeunload', () => { if (room) room.leave(); });
  const m = /^#\/sala\/([A-Za-z0-9]{2,8})$/.exec(location.hash);
  if (m) {
    const ref = normalizeCode(m[1]);
    const go = () => joinRef(ref);
    if (peerAvailable()) go(); else window.addEventListener('load', go, { once: true });
  }
  if (CONFIG.debug) window.__bomber = { get room() { return room; }, get game() { return game; }, prefs, MAX_PLAYERS };
}

boot();

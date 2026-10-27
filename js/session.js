// Salas: lógica de la sala de espera y de la partida para el anfitrión y para los clientes.
// La interfaz se suscribe con room.on(evento, fn):
//   state  · cambios en la sala de espera       chat  · mensaje de chat
//   start  · empieza la partida                 snap  · instantánea del mundo
//   roster · cambia la lista de jugadores        end   · resultados finales
//   lobby  · se vuelve a la sala de espera       closed · la sala se cerró (con motivo)
//   notice · aviso breve para el usuario         ping  · latencia medida
import {
  VERSION, TICK_MS, SNAP_EVERY, COLORS, ABILITY_IDS, MODES, MAX_PLAYERS, BOT_NAMES,
  normalizeSettings, DEFAULT_SETTINGS,
} from './data.js';
import { Sim } from './sim.js';
import { Bot, BOT_ABILITIES } from './bots.js';
import { cleanName, cleanText, mulberry32, shuffle, colorIndex } from './util.js';

const MAX_SPECTATORS = 4;
const CHAT_MAX = 140;

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  emit(type, data) { for (const fn of this.handlers[type] || []) { try { fn(data); } catch (e) { console.error(e); } } }
}

// Reloj de ticks que sigue funcionando con la pestaña en segundo plano (un Worker no se ralentiza).
class Ticker {
  constructor(fn) {
    this.fn = fn;
    this.acc = 0;
    this.last = performance.now();
    const onBeat = () => {
      const now = performance.now();
      this.acc += Math.min(250, now - this.last);
      this.last = now;
      let n = 0;
      while (this.acc >= TICK_MS && n < 8) { this.acc -= TICK_MS; n++; this.fn(); }
    };
    try {
      const src = 'let t=setInterval(()=>postMessage(0),8);onmessage=()=>{clearInterval(t);close()}';
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = onBeat;
    } catch {
      this.interval = setInterval(onBeat, 8);
    }
  }
  stop() {
    if (this.worker) { this.worker.postMessage(0); this.worker.terminate(); this.worker = null; }
    if (this.interval) clearInterval(this.interval);
  }
}

function sanitizeProfile(p) {
  return {
    name: cleanName(p && p.name) || 'Jugador',
    color: Number.isInteger(p && p.color) && p.color >= 0 && p.color < COLORS.length ? p.color : 0,
    ability: ABILITY_IDS.includes(p && p.ability) ? p.ability : 'dash',
  };
}

// =========================================================== partida (anfitrión)
class GameHost {
  constructor(room, roster, settings) {
    this.room = room;
    this.roster = roster;
    const seed = (Math.random() * 2 ** 31) | 0;
    this.sim = new Sim({ settings, roster, seed });
    const rand = mulberry32(seed ^ 0x5bd1e995);
    this.bots = new Map();
    for (const r of roster) if (r.bot) this.bots.set(r.slot, new Bot(r.slot, settings.botLevel, rand));
    this.rand = rand;
    this.queues = new Map();
    this.lastDir = new Map();
    this.lastIn = new Map();
    this.lastSeq = new Map();
    this.prevVer = null;
    this.evBuf = [];
    this.endSent = false;
    this.ticker = new Ticker(() => this.tick());
  }

  pushInput(slot, inp) {
    let q = this.queues.get(slot);
    if (!q) { q = []; this.queues.set(slot, q); }
    q.push(inp);
    while (q.length > 4) {
      const old = q.shift();
      if (old.bomb) q[0].bomb = true;
      if (old.ability) q[0].ability = true;
    }
  }

  addBot(r) { this.bots.set(r.slot, new Bot(r.slot, this.sim.settings.botLevel, this.rand)); }

  tick() {
    const sim = this.sim;
    const inputs = new Map();
    for (const r of this.roster) {
      if (r.bot) continue;
      const q = this.queues.get(r.slot);
      let inp = q && q.shift();
      if (inp) { this.lastDir.set(r.slot, inp.dir); this.lastIn.set(r.slot, sim.tick); }
      else {
        // Sin entrada reciente (pestaña oculta, red lenta): se repite la dirección un instante y luego se para.
        const stale = sim.tick - (this.lastIn.get(r.slot) || 0) > 9;
        inp = { dir: stale ? 0 : this.lastDir.get(r.slot) || 0, bomb: false, ability: false, seq: 0 };
      }
      inputs.set(r.slot, inp);
    }
    for (const [slot, bot] of this.bots) inputs.set(slot, bot.input(sim));
    sim.step(inputs);
    const ev = sim.drainEvents();
    if (ev.length) this.evBuf.push(...ev);
    if (sim.tick % SNAP_EVERY === 0 || ev.some(e => e[0] === 'over')) this.flush();
    if (sim.phase === 'over' && !this.endSent) {
      this.endSent = true;
      this.room.matchEnded(sim.results());
    }
  }

  flush() {
    const snap = this.sim.snapshot(this.prevVer);
    this.prevVer = this.sim.versions();
    snap.ev = this.evBuf;
    this.evBuf = [];
    this.room.broadcastSnap(snap);
  }

  fullSnapshot() {
    const s = this.sim.snapshot(null);
    s.ev = [];
    return s;
  }

  stop() { this.ticker.stop(); }
}

// ======================================================================= anfitrión
export class HostRoom extends Emitter {
  // net: HostNet o null (práctica sin conexión)
  constructor({ net, profile, settings, name, isPublic }) {
    super();
    this.role = 'host';
    this.net = net;
    this.selfId = 'host';
    this.local = !net;
    const me = sanitizeProfile(profile);
    this.state = {
      ref: net ? net.ref : '',
      name: cleanText(name, 28) || `Sala de ${me.name}`,
      isPublic: !!isPublic,
      hostId: 'host',
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...settings }),
      phase: 'lobby',
      members: [],
      ver: VERSION,
    };
    this.banned = new Set();
    this.rate = new Map();
    this.lastSeen = new Map();
    this.botSeq = 0;
    this.game = null;
    this.results = null;
    this.addMember({ id: 'host', ...me, ready: true, bot: false });
    if (net) {
      net.onJoin = id => this.lastSeen.set(id, performance.now());
      net.onLeave = id => this.removeMember(id, 'left');
      net.onMessage = (id, msg) => this.onMessage(id, msg);
      net.onInfo = () => this.info();
      this.heartbeat = setInterval(() => this.beat(), 2000);
    }
  }

  get settings() { return this.state.settings; }
  get members() { return this.state.members; }
  players() { return this.members.filter(m => !m.spectator); }
  member(id) { return this.members.find(m => m.id === id); }

  info() {
    return {
      name: this.state.name, mode: this.settings.mode, map: this.settings.map,
      players: this.players().length, max: this.settings.maxPlayers, phase: this.state.phase, ver: VERSION,
    };
  }

  freeColor(want) {
    const used = new Set(this.members.map(m => m.color));
    if (!used.has(want)) return want;
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return want;
  }

  smallerTeam() {
    const ps = this.players();
    const a = ps.filter(m => m.team === 0).length, b = ps.filter(m => m.team === 1).length;
    return a <= b ? 0 : 1;
  }

  addMember(m) {
    const member = {
      id: m.id, name: m.name, color: this.freeColor(m.color), ability: m.ability,
      team: this.smallerTeam(), ready: !!m.ready, bot: !!m.bot, spectator: !!m.spectator, ping: 0,
      joinedAt: Date.now(),
    };
    this.members.push(member);
    return member;
  }

  publish() {
    this.emit('state', this.state);
    if (this.net) this.net.broadcast({ t: 'lobby', s: this.state });
  }

  sys(text) { this.relayChat({ sys: true, text }); }

  relayChat(msg) {
    this.emit('chat', msg);
    if (this.net) this.net.broadcast({ t: 'chat', ...msg });
  }

  beat() {
    const now = performance.now();
    for (const [id, t] of this.lastSeen) {
      if (now - t > 12000) { this.lastSeen.delete(id); this.net.drop(id); this.removeMember(id, 'timeout'); }
    }
    if (this.state.phase === 'lobby') this.publish();
  }

  // ------------------------------------------------------------- mensajes
  onMessage(id, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    this.lastSeen.set(id, performance.now());
    // Límite de mensajes por segundo y conexión
    const now = performance.now();
    let r = this.rate.get(id);
    if (!r || now - r.t > 1000) { r = { t: now, n: 0 }; this.rate.set(id, r); }
    if (++r.n > 90) return;

    const m = this.member(id);
    if (msg.t === 'hello') { this.onHello(id, msg); return; }
    if (msg.t === 'ping') {
      this.net.send(id, { t: 'pong', c: msg.c });
      if (m && Number.isFinite(msg.r)) m.ping = Math.max(0, Math.min(9999, Math.round(msg.r)));
      return;
    }
    if (!m) return;
    switch (msg.t) {
      case 'in': this.onInput(m, msg); break;
      case 'set': this.applySet(m, msg); break;
      case 'chat': {
        const text = cleanText(msg.text, CHAT_MAX);
        if (!text) return;
        if (now - (m.lastChat || 0) < 450) return;
        m.lastChat = now;
        this.relayChat({ id: m.id, name: m.name, color: m.color, text });
        break;
      }
      case 'bye': this.net.drop(id); this.removeMember(id, 'left'); break;
      default: break;
    }
  }

  onHello(id, msg) {
    const reject = reason => { this.net.send(id, { t: 'reject', reason }); this.net.drop(id); };
    if (msg.v !== VERSION) return reject('version');
    if (this.banned.has(id)) return reject('kicked');
    if (this.member(id)) return;
    const prof = sanitizeProfile(msg);
    const inGame = this.state.phase === 'game';
    let spectator = false;
    if (this.players().length >= this.settings.maxPlayers) {
      const bot = !inGame && [...this.members].reverse().find(x => x.bot);
      if (bot) this.removeMember(bot.id, 'replaced');
      else spectator = true;
    }
    const midJoin = inGame && !spectator && MODES[this.settings.mode].respawn;
    if (inGame && !midJoin) spectator = true;
    if (spectator && this.members.filter(x => x.spectator).length >= MAX_SPECTATORS) return reject('full');
    const member = this.addMember({ id, ...prof, ready: false, spectator });
    this.net.send(id, { t: 'welcome', id });
    this.sys(`${member.name} ha entrado${spectator ? ' como espectador' : ''}.`);
    if (inGame && this.game) {
      if (midJoin) this.joinMidGame(member);
      this.net.send(id, this.startMessage(member.id));
    }
    this.publish();
  }

  applySet(m, msg) {
    if (this.state.phase !== 'lobby') {
      if (typeof msg.ready === 'boolean') m.ready = msg.ready;
      return;
    }
    if (typeof msg.ready === 'boolean') m.ready = msg.ready;
    if (ABILITY_IDS.includes(msg.ability)) m.ability = msg.ability;
    if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length &&
      !this.members.some(o => o !== m && o.color === msg.color)) m.color = msg.color;
    if (msg.team === 0 || msg.team === 1) m.team = msg.team;
    if (typeof msg.spectator === 'boolean') {
      if (msg.spectator) m.spectator = true;
      else if (this.players().length < this.settings.maxPlayers) m.spectator = false;
    }
    this.publish();
  }

  onInput(m, msg) {
    if (!this.game || m.slot == null) return;
    const seq = msg.s;
    if (!Number.isInteger(seq) || seq <= (m.lastSeq || 0)) return;
    m.lastSeq = seq;
    const dir = Number.isInteger(msg.d) && msg.d >= 0 && msg.d <= 4 ? msg.d : 0;
    this.game.pushInput(m.slot, { dir, bomb: !!msg.b, ability: !!msg.a, seq });
  }

  removeMember(id, why) {
    const m = this.member(id);
    if (!m) return;
    this.state.members = this.members.filter(x => x !== m);
    this.lastSeen.delete(id);
    if (this.game && m.slot != null) {
      this.game.sim.removePlayer(m.slot);
      this.game.bots.delete(m.slot);
    }
    if (!m.bot && why !== 'replaced') {
      this.sys(why === 'kicked' ? `${m.name} ha sido expulsado.` : `${m.name} ha salido.`);
    }
    this.publish();
  }

  // ----------------------------------------------- acciones del anfitrión
  setSelf(patch) { this.applySet(this.member('host'), patch); }

  updateSettings(patch) {
    if (this.state.phase !== 'lobby') return;
    const next = normalizeSettings({ ...this.settings, ...patch });
    const humans = this.players().filter(m => !m.bot).length;
    if (next.maxPlayers < humans) next.maxPlayers = humans;
    this.state.settings = next;
    while (this.players().length > next.maxPlayers) {
      const bot = [...this.members].reverse().find(x => x.bot);
      if (!bot) break;
      this.state.members = this.members.filter(x => x !== bot);
    }
    this.publish();
  }

  addBot() {
    if (this.state.phase !== 'lobby' || this.players().length >= this.settings.maxPlayers) return false;
    const used = new Set(this.members.map(m => m.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${++this.botSeq}`;
    this.addMember({
      id: `bot-${Date.now().toString(36)}-${++this.botSeq}`, name, color: Math.floor(Math.random() * COLORS.length),
      ability: BOT_ABILITIES[Math.floor(Math.random() * BOT_ABILITIES.length)], ready: true, bot: true,
    });
    this.publish();
    return true;
  }

  removeBot(id) {
    const m = this.member(id);
    if (!m || !m.bot || this.state.phase !== 'lobby') return;
    this.state.members = this.members.filter(x => x !== m);
    this.publish();
  }

  kick(id) {
    const m = this.member(id);
    if (!m || m.id === 'host') return;
    if (m.bot) { this.removeBot(id); return; }
    this.banned.add(id);
    this.net.send(id, { t: 'kicked' });
    this.net.drop(id);
    this.removeMember(id, 'kicked');
  }

  chat(text) {
    const t = cleanText(text, CHAT_MAX);
    if (!t) return;
    const me = this.member('host');
    this.relayChat({ id: 'host', name: me.name, color: me.color, text: t });
  }

  canStart() {
    const ps = this.players();
    if (ps.length < 2) return 'Hacen falta al menos 2 jugadores. Añade bots o invita a alguien.';
    const waiting = ps.filter(m => !m.bot && m.id !== 'host' && !m.ready);
    if (waiting.length) return `Falta que ${waiting.map(m => m.name).join(', ')} ${waiting.length > 1 ? 'estén listos' : 'esté listo'}.`;
    return '';
  }

  startGame() {
    if (this.state.phase !== 'lobby') return;
    const why = this.canStart();
    if (why) { this.emit('notice', why); return; }
    const s = this.settings;
    const ps = this.players().slice(0, s.maxPlayers);
    if (MODES[s.mode].teams) {
      const t0 = ps.filter(m => m.team === 0), t1 = ps.filter(m => m.team === 1);
      if (!t0.length || !t1.length || Math.abs(t0.length - t1.length) > 1) {
        shuffle(ps.slice()).forEach((m, i) => { m.team = i % 2; });
      }
    }
    this.roster = ps.map((m, i) => {
      m.slot = i;
      m.lastSeq = 0;
      return { slot: i, id: m.id, name: m.name, color: m.color, team: m.team, ability: m.ability, bot: m.bot };
    });
    for (const m of this.members) if (m.spectator) m.slot = null;
    this.results = null;
    this.game = new GameHost(this, this.roster, s);
    this.state.phase = 'game';
    this.publish();
    if (this.net) for (const m of this.members) if (!m.bot && m.id !== 'host') this.net.send(m.id, this.startMessage(m.id));
    this.emit('start', this.startData('host'));
  }

  joinMidGame(member) {
    const used = new Set(this.roster.map(r => r.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= MAX_PLAYERS) { member.spectator = true; return; }
    member.slot = slot;
    member.lastSeq = 0;
    const r = { slot, id: member.id, name: member.name, color: member.color, team: member.team, ability: member.ability, bot: false };
    this.roster.push(r);
    this.game.sim.addPlayer(r);
    this.emit('roster', this.roster);
    if (this.net) this.net.broadcast({ t: 'roster', roster: this.roster }, member.id);
  }

  startData(id) {
    const m = this.member(id);
    return {
      roster: this.roster, settings: this.settings, you: m && m.slot != null ? m.slot : -1,
      snap: this.game.fullSnapshot(),
    };
  }
  startMessage(id) { return { t: 'start', ...this.startData(id) }; }

  broadcastSnap(snap) {
    this.emit('snap', snap);
    if (this.net) this.net.broadcast({ t: 's', ...snap });
  }

  sendInput(inp) {
    const m = this.member('host');
    if (this.game && m && m.slot != null) this.game.pushInput(m.slot, inp);
  }

  matchEnded(results) {
    this.results = results;
    this.emit('end', results);
    if (this.net) this.net.broadcast({ t: 'end', results });
  }

  backToLobby() {
    if (this.state.phase !== 'game') return;
    if (this.game) { this.game.stop(); this.game = null; }
    this.state.phase = 'lobby';
    for (const m of this.members) {
      m.slot = null;
      if (!m.bot && m.id !== 'host') m.ready = false;
    }
    // Los espectadores pasan a jugar si hay sitio
    for (const m of this.members) if (m.spectator && this.players().length < this.settings.maxPlayers) m.spectator = false;
    this.publish();
    this.emit('lobby');
    if (this.net) this.net.broadcast({ t: 'lobbyBack' });
  }

  leave() {
    if (this.game) { this.game.stop(); this.game = null; }
    clearInterval(this.heartbeat);
    if (this.net) {
      this.net.broadcast({ t: 'closed', reason: 'host' });
      const net = this.net;
      setTimeout(() => net.destroy(), 250);
    }
    this.net = null;
  }
}

// ========================================================================= cliente
export class ClientRoom extends Emitter {
  constructor(net, profile, ref) {
    super();
    this.role = 'client';
    this.net = net;
    this.ref = ref;
    this.selfId = null;
    this.state = null;
    this.inGame = false;
    this.rtt = 0;
    this.lastMsg = performance.now();
    this.done = false;
    net.onMessage = msg => this.onMessage(msg);
    net.onClose = () => this.close('lost');
    net.send({ t: 'hello', v: VERSION, ...sanitizeProfile(profile) });
    this.pinger = setInterval(() => {
      net.send({ t: 'ping', c: performance.now(), r: this.rtt });
      if (performance.now() - this.lastMsg > 12000) this.close('timeout');
    }, 2000);
  }

  close(reason) {
    if (this.done) return;
    this.done = true;
    clearInterval(this.pinger);
    this.net.destroy();
    this.emit('closed', { reason });
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.lastMsg = performance.now();
    switch (msg.t) {
      case 'welcome': this.selfId = String(msg.id); break;
      case 'lobby': {
        const s = sanitizeState(msg.s);
        if (!s) return;
        this.state = s;
        this.emit('state', s);
        break;
      }
      case 'reject': this.close(msg.reason === 'version' ? 'version' : msg.reason === 'kicked' ? 'kicked' : 'full'); break;
      case 'kicked': this.close('kicked'); break;
      case 'closed': this.close('host'); break;
      case 'chat': {
        const text = cleanText(msg.text, CHAT_MAX);
        if (!text) return;
        this.emit('chat', msg.sys ? { sys: true, text } : { id: String(msg.id), name: cleanName(msg.name), color: colorIndex(msg.color, COLORS.length), text });
        break;
      }
      case 'start':
        if (!Array.isArray(msg.roster) || !msg.snap) return;
        this.inGame = true;
        this.emit('start', { roster: sanitizeRoster(msg.roster), settings: normalizeSettings(msg.settings), you: msg.you | 0, snap: msg.snap });
        break;
      case 's': if (this.inGame) this.emit('snap', msg); break;
      case 'roster': if (Array.isArray(msg.roster)) this.emit('roster', sanitizeRoster(msg.roster)); break;
      case 'end': this.emit('end', msg.results); break;
      case 'lobbyBack': this.inGame = false; this.emit('lobby'); break;
      case 'pong':
        if (Number.isFinite(msg.c)) { this.rtt = performance.now() - msg.c; this.emit('ping', this.rtt); }
        break;
      default: break;
    }
  }

  setSelf(patch) { this.net.send({ t: 'set', ...patch }); }
  chat(text) { const t = cleanText(text, CHAT_MAX); if (t) this.net.send({ t: 'chat', text: t }); }
  sendInput(inp) { this.net.send({ t: 'in', s: inp.seq, d: inp.dir, b: inp.bomb ? 1 : 0, a: inp.ability ? 1 : 0 }); }
  leave() {
    if (this.done) return;
    this.net.send({ t: 'bye' });
    this.done = true;
    clearInterval(this.pinger);
    const net = this.net;
    setTimeout(() => net.destroy(), 150);
  }
}

function sanitizeRoster(list) {
  return list.slice(0, MAX_PLAYERS * 2).map(r => ({
    slot: Math.max(0, Math.min(MAX_PLAYERS - 1, r.slot | 0)), id: String(r.id).slice(0, 64), name: cleanName(r.name) || '?', color: colorIndex(r.color, COLORS.length),
    team: r.team ? 1 : 0, ability: ABILITY_IDS.includes(r.ability) ? r.ability : null, bot: !!r.bot,
  }));
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.members)) return null;
  return {
    ref: cleanText(s.ref, 8), name: cleanText(s.name, 28), isPublic: !!s.isPublic, hostId: 'host',
    settings: normalizeSettings(s.settings), phase: s.phase === 'game' ? 'game' : 'lobby',
    members: s.members.slice(0, 16).map(m => ({
      id: String(m.id).slice(0, 64), name: cleanName(m.name) || '?', color: colorIndex(m.color, COLORS.length),
      ability: ABILITY_IDS.includes(m.ability) ? m.ability : 'dash', team: m.team ? 1 : 0, ready: !!m.ready,
      bot: !!m.bot, spectator: !!m.spectator, ping: Math.max(0, m.ping | 0),
    })),
  };
}

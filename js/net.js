// Capa de red sobre PeerJS (WebRTC). Topología en estrella: todos los clientes se conectan
// al anfitrión, que es autoritativo.
import { CONFIG } from './config.js';
import { normalizeCode } from './util.js';

export const pubId = slot => `${CONFIG.appId}-pub-${slot}`;
export const prvId = code => `${CONFIG.appId}-prv-${code}`;

// Referencia de sala visible para el usuario: código privado (5 caracteres) o P1..P12 para públicas.
export function refToPeerId(ref) {
  const r = normalizeCode(ref);
  const m = /^P(\d{1,2})$/.exec(r);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= CONFIG.publicSlots) return pubId(n - 1);
    return null;
  }
  if (r.length < 4) return null;
  return prvId(r);
}

export class NetError extends Error {
  constructor(type, message) { super(message); this.type = type; }
}

export function peerAvailable() { return typeof window.Peer === 'function'; }

function friendly(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'La sala no existe o ya se cerró.';
    case 'unavailable-id': return 'Ese identificador de sala ya está en uso.';
    case 'browser-incompatible': return 'Tu navegador no admite WebRTC.';
    case 'network': case 'socket-error': case 'socket-closed': case 'server-error':
      return 'No se pudo contactar con el servidor de emparejamiento. Revisa tu conexión e inténtalo de nuevo.';
    case 'timeout': return err.message || 'Se agotó el tiempo de espera.';
    default: return (err && err.message) || 'Error de red desconocido.';
  }
}
export { friendly as friendlyError };

function openPeer(id, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!peerAvailable()) { reject(new NetError('browser-incompatible', 'No se pudo cargar PeerJS.')); return; }
    let done = false;
    const peer = id ? new window.Peer(id, CONFIG.peer) : new window.Peer(CONFIG.peer);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { peer.destroy(); } catch { /* nada */ }
      reject(new NetError('timeout', 'El servidor de emparejamiento no responde.'));
    }, timeoutMs);
    peer.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve(peer); });
    peer.on('error', err => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { peer.destroy(); } catch { /* nada */ }
      reject(new NetError(err.type, friendly(err)));
    });
  });
}

// ------------------------------------------------------------------ anfitrión
export class HostNet {
  constructor(peer, ref, isPublic) {
    this.peer = peer;
    this.ref = ref;
    this.isPublic = isPublic;
    this.conns = new Map();   // peerId -> DataConnection
    this.onMessage = () => {};
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onInfo = () => null;
    this.closed = false;
    peer.on('connection', conn => this.accept(conn));
    peer.on('disconnected', () => {
      // Se perdió el servidor de emparejamiento; las conexiones abiertas siguen vivas.
      if (!this.closed) setTimeout(() => { try { if (!this.closed && peer.disconnected) peer.reconnect(); } catch { /* nada */ } }, 1500);
    });
    peer.on('error', err => { if (CONFIG.debug) console.warn('host peer error', err.type, err.message); });
  }

  static async create(isPublic, code) {
    if (!isPublic) {
      const peer = await openPeer(prvId(code));
      return new HostNet(peer, code, false);
    }
    const order = [...Array(CONFIG.publicSlots).keys()];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let lastErr = null;
    for (const slot of order) {
      try {
        const peer = await openPeer(pubId(slot), 8000);
        return new HostNet(peer, `P${slot + 1}`, true);
      } catch (e) {
        lastErr = e;
        if (e.type !== 'unavailable-id') throw e;
      }
    }
    throw new NetError('full', lastErr && lastErr.type === 'unavailable-id'
      ? 'Todas las salas públicas están ocupadas. Crea una sala privada.'
      : friendly(lastErr));
  }

  accept(conn) {
    const id = conn.peer;
    let joined = false;
    // Una conexión solo cuenta como jugador cuando envía algo distinto de una consulta
    // de información (las consultas de la lista de salas se cierran enseguida).
    conn.on('data', data => {
      if (this.closed) return;
      if (data && data.t === 'info') {
        const info = this.onInfo();
        if (info) try { conn.send({ t: 'info', ...info }); } catch { /* nada */ }
        return;
      }
      if (!joined) {
        joined = true;
        const old = this.conns.get(id);
        if (old && old !== conn) try { old.close(); } catch { /* nada */ }
        this.conns.set(id, conn);
        this.onJoin(id);
      }
      if (this.conns.get(id) !== conn) return;
      this.onMessage(id, data, conn);
    });
    const gone = () => {
      if (this.conns.get(id) === conn) { this.conns.delete(id); this.onLeave(id); }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (!c || !c.open) return;
    const go = () => { try { c.send(msg); } catch (e) { if (CONFIG.debug) console.warn('send', e); } };
    if (CONFIG.lag) setTimeout(go, CONFIG.lag); else go();
  }

  broadcast(msg, except) {
    for (const id of this.conns.keys()) if (id !== except) this.send(id, msg);
  }

  drop(id) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (c) setTimeout(() => { try { c.close(); } catch { /* nada */ } }, 300);
  }

  destroy() {
    this.closed = true;
    for (const c of this.conns.values()) try { c.close(); } catch { /* nada */ }
    this.conns.clear();
    try { this.peer.destroy(); } catch { /* nada */ }
  }
}

// -------------------------------------------------------------------- cliente
export class ClientNet {
  constructor(peer, conn) {
    this.peer = peer;
    this.conn = conn;
    this.onMessage = () => {};
    this.onClose = () => {};
    this.closed = false;
    conn.on('data', d => { if (!this.closed) this.onMessage(d); });
    const end = () => { if (this.closed) return; this.closed = true; this.onClose(); };
    conn.on('close', end);
    conn.on('error', end);
    peer.on('disconnected', () => { try { if (!this.closed) peer.reconnect(); } catch { /* nada */ } });
  }

  static async connect(hostPeerId, timeoutMs = 15000) {
    const peer = await openPeer(null);
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (type, msg) => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { peer.destroy(); } catch { /* nada */ }
        reject(new NetError(type, msg));
      };
      const timer = setTimeout(() => fail('timeout', 'No se pudo conectar con la sala. Puede que el anfitrión esté detrás de una red muy restrictiva.'), timeoutMs);
      peer.on('error', err => fail(err.type, friendly(err)));
      const conn = peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(new ClientNet(peer, conn));
      });
      conn.on('error', () => fail('peer-unavailable', 'No se pudo conectar con la sala.'));
    });
  }

  send(msg) {
    if (this.closed || !this.conn.open) return;
    const go = () => { try { this.conn.send(msg); } catch { /* nada */ } };
    if (CONFIG.lag) setTimeout(go, CONFIG.lag); else go();
  }

  destroy() {
    this.closed = true;
    try { this.conn.close(); } catch { /* nada */ }
    setTimeout(() => { try { this.peer.destroy(); } catch { /* nada */ } }, 200);
  }
}

// ------------------------------------------------------------- listar salas
// Pregunta a cada hueco público por su información. Devuelve la lista de salas encontradas.
export class Browser {
  constructor() { this.peer = null; this.opening = null; }

  async ensurePeer() {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected) return this.peer;
    if (!this.opening) {
      if (this.peer) try { this.peer.destroy(); } catch { /* nada */ }
      this.opening = openPeer(null).finally(() => { this.opening = null; });
      this.peer = await this.opening;
    } else await this.opening;
    return this.peer;
  }

  // onRoom(sala) se llama en cuanto responde cada sala; la promesa se resuelve con la lista completa.
  async scan(onRoom, timeoutMs = 6000) {
    const peer = await this.ensurePeer();
    const rooms = [];
    const pending = new Set();
    return await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        peer.off('error', onErr);
        for (const c of conns) try { c.close(); } catch { /* nada */ }
        resolve(rooms.sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.players - a.players));
      };
      const timer = setTimeout(finish, timeoutMs);
      const settle = slot => { pending.delete(slot); if (!pending.size) finish(); };
      const onErr = err => {
        if (err.type !== 'peer-unavailable') return;
        const m = /-pub-(\d+)/.exec(err.message || '');
        if (m) settle(Number(m[1]));
      };
      peer.on('error', onErr);
      const conns = [];
      for (let s = 0; s < CONFIG.publicSlots; s++) {
        pending.add(s);
        const conn = peer.connect(pubId(s), { reliable: true, serialization: 'json' });
        conns.push(conn);
        conn.on('open', () => conn.send({ t: 'info' }));
        conn.on('data', d => {
          if (d && d.t === 'info' && typeof d.name === 'string') {
            const room = {
              ref: `P${s + 1}`, name: String(d.name).slice(0, 32), mode: d.mode, map: d.map,
              players: d.players | 0, max: d.max | 0, phase: d.phase === 'game' ? 'game' : 'lobby',
              ver: d.ver,
            };
            rooms.push(room);
            if (onRoom) try { onRoom(room); } catch { /* nada */ }
          }
          settle(s);
          try { conn.close(); } catch { /* nada */ }
        });
        conn.on('error', () => settle(s));
      }
    });
  }

  destroy() {
    if (this.peer) try { this.peer.destroy(); } catch { /* nada */ }
    this.peer = null;
  }
}

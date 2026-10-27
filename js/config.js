// Configuración del multijugador.
//
// GitHub Pages solo sirve archivos estáticos, así que Bomber usa WebRTC entre navegadores.
// PeerJS (y su servidor público y gratuito 0.peerjs.com) solo se usa para que los navegadores
// se encuentren; después, la partida viaja directamente entre jugadores.
const params = new URLSearchParams(location.search);

export const CONFIG = {
  // Prefijo de los identificadores de sala. Cámbialo (por ejemplo, añade tu usuario de GitHub)
  // para que tu despliegue tenga su propia lista de salas públicas.
  appId: 'bomber-elcybercurioso-v1',
  // Número de huecos de sala pública que se consultan al listar salas.
  publicSlots: 12,
  // Opciones para new Peer(). Vacío = servidor público de PeerJS con sus servidores STUN/TURN.
  // Servidor propio: { host: 'mi.servidor.com', port: 443, path: '/bomber', secure: true }
  // TURN propio (redes muy restrictivas): añade config: { iceServers: [...] }
  peer: {},
  debug: params.get('debug') === '1',
  // Latencia artificial (ms de ida) para probar la predicción: ?lag=80
  lag: Math.max(0, Math.min(1000, Number(params.get('lag')) || 0)),
};

// Pruebas con un servidor de señalización local: ?peerhost=localhost&peerport=9000
if (params.get('peerhost')) {
  const host = params.get('peerhost');
  CONFIG.peer = {
    host,
    port: Number(params.get('peerport') || 9000),
    path: params.get('peerpath') || '/bomber',
    secure: params.get('peersecure') === '1',
  };
  if (host === 'localhost' || host === '127.0.0.1') CONFIG.peer.config = { iceServers: [] };
}
if (params.get('app')) CONFIG.appId = params.get('app').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || CONFIG.appId;

// Servidor de señalización PeerJS local, solo para pruebas en tu máquina.
// Uso: npm install && npm run peer   →  abre el juego con ?peerhost=localhost&peerport=9000
import { PeerServer } from 'peer';

const port = Number(process.env.PORT || 9000);
PeerServer({ port, host: '127.0.0.1', path: '/bomber', allow_discovery: false });
console.log(`Señalización PeerJS en http://127.0.0.1:${port}/bomber`);

// Mapa de peligro: en qué tick (relativo a ahora) empieza y termina el fuego en cada casilla.
// Lo usan los bots para huir y la simulación para elegir un punto de reaparición seguro.
import { T, W, H, RULES } from './data.js';
import { DX, DY } from './move.js';

// Casillas que alcanzaría una bomba en (tx, ty).
export function blastTiles(tiles, bombIdx, tx, ty, fire, pierce) {
  const out = [ty * W + tx];
  for (let dir = 1; dir <= 4; dir++) {
    for (let r = 1; r <= fire; r++) {
      const x = tx + DX[dir] * r, y = ty + DY[dir] * r;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const idx = y * W + x;
      const t = tiles[idx];
      if (t === T.WALL || t === T.FALL) break;
      out.push(idx);
      if (t === T.BLOCK || t === T.BURN) { if (!pierce) break; continue; }
      if (bombIdx && bombIdx.has(idx)) break;
    }
  }
  return out;
}

// bombs: [{ idx, fuse, fire, pierce }]; flameT: array con los ticks de fuego restantes.
export function dangerMap(tiles, bombs, flameT) {
  const N = W * H;
  const start = new Float32Array(N).fill(Infinity);
  const end = new Float32Array(N).fill(-1);
  if (flameT) {
    for (let i = 0; i < N; i++) if (flameT[i] > 0) { start[i] = 0; end[i] = flameT[i] + 1; }
  }
  if (!bombs.length) return { start, end };
  const bombIdx = new Map();
  const list = bombs.map(b => ({ ...b, time: b.fuse }));
  for (const b of list) bombIdx.set(b.idx, b);
  // Reacciones en cadena: una bomba alcanzada estalla a la vez que la que la alcanza.
  let changed = true, guard = 0;
  const blasts = new Map();
  for (const b of list) blasts.set(b, blastTiles(tiles, bombIdx, b.idx % W, (b.idx / W) | 0, b.fire, b.pierce));
  while (changed && guard++ < 50) {
    changed = false;
    for (const b of list) {
      for (const idx of blasts.get(b)) {
        const o = bombIdx.get(idx);
        if (o && o !== b && o.time > b.time) { o.time = b.time; changed = true; }
      }
    }
  }
  for (const b of list) {
    for (const idx of blasts.get(b)) {
      if (b.time < start[idx]) start[idx] = b.time;
      const e = b.time + RULES.flame + 1;
      if (e > end[idx]) end[idx] = e;
    }
  }
  return { start, end };
}

// Movimiento en rejilla compartido por el anfitrión (simulación) y el cliente (predicción).
// Las posiciones son el centro del personaje en unidades de casilla: la casilla (tx, ty)
// tiene su centro en (tx + 0.5, ty + 0.5). El personaje ocupa una casilla completa y solo
// avanza por un eje alineado; al girar entre pilares se desliza solo hacia el carril libre.
import { T, W } from './data.js';

export const DX = [0, 0, 1, 0, -1];
export const DY = [0, -1, 0, 1, 0];
export const OPP = [0, 3, 4, 1, 2];
const EPS = 0.003;
const ASSIST = 0.12; // a partir de este desplazamiento se puede doblar hacia el carril contiguo

export function tileOf(v) { return Math.floor(v); }

// Casillas que pisa ahora mismo el personaje (para poder salir de la bomba que acaba de dejar).
export function overlapTiles(x, y) {
  const out = [];
  const x0 = Math.floor(x - 0.5 + EPS), x1 = Math.floor(x + 0.5 - EPS);
  const y0 = Math.floor(y - 0.5 + EPS), y1 = Math.floor(y + 0.5 - EPS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push(ty * W + tx);
  return out;
}

// Construye la función de bloqueo para un personaje.
// world: { tiles, bombAt(idx) -> bool }
export function playerBlocker(world, x, y, ghost) {
  const over = overlapTiles(x, y);
  return (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty * W + tx >= world.tiles.length) return true;
    const idx = ty * W + tx;
    const t = world.tiles[idx];
    if (t === T.WALL || t === T.FALL) return true;
    if (ghost) return false;
    if (t === T.BLOCK || t === T.BURN) return true;
    if (world.bombAt(idx) && !over.includes(idx)) return true;
    return false;
  };
}

// Avanza `dist` casillas en la dirección `dir` (1 arriba, 2 derecha, 3 abajo, 4 izquierda).
// Modifica p.x / p.y y devuelve la distancia recorrida.
export function moveStep(p, dir, dist, blocked) {
  if (!dir || dist <= 0) return 0;
  const horiz = dir === 2 || dir === 4;
  const d = dir === 2 || dir === 3 ? 1 : -1;
  const B = horiz ? (m, n) => blocked(m, n) : (m, n) => blocked(n, m);
  let a = horiz ? p.x : p.y;
  let c = horiz ? p.y : p.x;
  let rem = dist;

  // 1) Alinear el eje perpendicular (ayuda en las esquinas)
  const row = Math.floor(c);
  const cc = row + 0.5;
  const off = c - cc;
  if (Math.abs(off) > EPS) {
    const ta = Math.floor(a);
    let target = null;
    if (!B(ta + d, row)) target = cc;
    else {
      const other = off > 0 ? row + 1 : row - 1;
      if (Math.abs(off) >= ASSIST && !B(ta + d, other) && !B(ta, other)) target = other + 0.5;
    }
    if (target === null) return 0;
    const need = Math.abs(target - c);
    const s = Math.min(rem, need);
    c += Math.sign(target - c) * s;
    rem -= s;
    if (Math.abs(target - c) < EPS) c = target;
    if (rem <= 1e-9) { write(p, horiz, a, c); return dist; }
  } else {
    c = cc;
  }

  // 2) Avanzar por el eje principal
  const lane = Math.floor(c);
  let guard = 8;
  while (rem > 1e-9 && guard-- > 0) {
    const t = Math.floor(a);
    const center = t + 0.5;
    let step;
    if (d > 0) {
      if (a < center - 1e-9) step = Math.min(rem, center - a);
      else {
        if (B(t + 1, lane)) break;
        step = Math.min(rem, t + 1.5 - a);
      }
    } else {
      if (a > center + 1e-9) step = Math.min(rem, a - center);
      else {
        if (B(t - 1, lane)) break;
        step = Math.min(rem, a - (t - 0.5));
      }
    }
    a += d * step;
    rem -= step;
  }
  write(p, horiz, a, c);
  return dist - rem;
}

function write(p, horiz, a, c) {
  if (horiz) { p.x = a; p.y = c; } else { p.y = a; p.x = c; }
}

// ¿Está el personaje centrado en el eje perpendicular a `dir`?
export function aligned(p, dir) {
  const v = dir === 2 || dir === 4 ? p.y : p.x;
  return Math.abs(v - (Math.floor(v) + 0.5)) < 0.02;
}

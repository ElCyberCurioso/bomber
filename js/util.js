// Utilidades compartidas (sin dependencias del DOM: también se usan en las pruebas con Node).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomInt(n, rand = Math.random) { return Math.floor(rand() * n); }

// Limpia texto que llega de otros jugadores: sin caracteres de control y con longitud acotada.
// El texto siempre se pinta con textContent, nunca como HTML.
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function cleanName(v) { return cleanText(v, 16); }

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(n = 5) {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}
export function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

export function fmtTime(ticks, rate = 30) {
  const s = Math.max(0, Math.ceil(ticks / rate));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Índice de color seguro (también con valores negativos o no numéricos)
export function colorIndex(v, n = 8) {
  const i = Number.isInteger(v) ? v : 0;
  return ((i % n) + n) % n;
}

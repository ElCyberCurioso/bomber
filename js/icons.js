// Iconos SVG propios (viewBox 24x24). Se usan en la interfaz y, convertidos en imágenes,
// para pintar los potenciadores en el tablero.
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

export const ICONS = {
  // potenciadores
  bomb: `<circle cx="10.5" cy="14" r="7.5"/><path d="M15 8.5 18 5.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M20 1.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>`,
  fire: `<path d="M12.5 1.5c.6 3.6 5.8 5.8 5.8 12.1A6.3 6.3 0 0 1 12 20a6.3 6.3 0 0 1-6.3-6.4c0-3.1 1.6-5.2 3.3-6.8.2 2.2 1.1 3.4 2.4 3.9-.4-3.2-.2-6.1 1.1-9.2z"/>`,
  speed: `<path d="M14 1.5 4.5 13.8h6.2L9 22.5l10.5-13.2h-6.3z"/>`,
  kick: `<path d="M6 2.5h7v8.3l5.7 2.6c1.7.8 2.8 2.2 2.8 4.1V20H3.2v-4.6H6z"/><path d="M2.5 22h19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  pierce: `<rect x="8.5" y="4" width="7" height="16" rx="1.5" opacity=".45"/><path d="M2 12h17.5M15 7.2l5 4.8-5 4.8" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  shield: `<path d="M12 1.8 20.5 5v6.2c0 5.3-3.6 9.3-8.5 11-4.9-1.7-8.5-5.7-8.5-11V5z"/>`,
  maxfire: `<path d="M12.5 4.5c.6 3.2 5.3 5.2 5.3 10.8A5.8 5.8 0 0 1 12 21.2a5.8 5.8 0 0 1-5.8-5.9c0-2.8 1.5-4.7 3-6.2.2 2 1 3.1 2.2 3.6-.4-2.9-.2-5.5 1.1-8.2z"/><path d="M4 1.5l2.5 2.3L9 1.5V5H4zM15 1.5l2.5 2.3L20 1.5V5h-5z"/>`,
  skull: `<path fill-rule="evenodd" d="M12 2a8.5 8.5 0 0 0-8.5 8.5c0 3 1.4 5 3.2 6.2V20a2 2 0 0 0 2 2h6.6a2 2 0 0 0 2-2v-3.3c1.8-1.2 3.2-3.2 3.2-6.2A8.5 8.5 0 0 0 12 2z${circ(8.6, 11, 2.2)}${circ(15.4, 11, 2.2)}"/><path d="M10 18.5h4" stroke="#0004" stroke-width="1.6"/>`,
  coin: `<path fill-rule="evenodd" d="${circ(12, 12, 9.5)}${circ(12, 12, 6)}"/><path d="M12 8.2l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z"/>`,
  // habilidades
  dash: `<path d="M9 4l8 8-8 8h5l8-8-8-8z"/><path d="M2 8h6M1 12h7M2 16h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  barrier: `<path fill-rule="evenodd" d="M12 1.5 21.1 6.7v10.6L12 22.5l-9.1-5.2V6.7zM12 5.2 6.1 8.6v6.8l5.9 3.4 5.9-3.4V8.6z"/><path d="M12 8.3 15.2 10.2v3.6L12 15.7l-3.2-1.9v-3.6z"/>`,
  builder: `<path d="M2 9h9v5H2zM13 9h9v5h-9zM2 16h4.5v5H2zM8.5 16h7v5h-7zM17.5 16H22v5h-4.5z"/><path d="M12 1.5v5M9.5 4h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  ghost: `<path fill-rule="evenodd" d="M12 2a7.5 7.5 0 0 0-7.5 7.5V22l2.5-2 2.5 2 2.5-2 2.5 2 2.5-2 2.5 2V9.5A7.5 7.5 0 0 0 12 2z${circ(9.2, 10, 1.7)}${circ(14.8, 10, 1.7)}"/>`,
  detonator: `<rect x="5" y="12" width="14" height="10" rx="2"/><path d="M12 12V6.5M8.5 6.5h7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 4.5 1.8 2.3M20 4.5l2.2-2.2M12 2.8V1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  frost: `<path d="M12 1.5v21M2.9 6.8l18.2 10.4M2.9 17.2 21.1 6.8M12 1.5 9.5 4M12 1.5 14.5 4M12 22.5 9.5 20M12 22.5l2.5-2.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
  // interfaz
  crown: `<path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>`,
  copy: `<rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 16V5a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2"/>`,
  close: `<path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  robot: `<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="2.8" r="1.6"/><path fill="#0006" d="M8 12h2.5v3H8zM13.5 12H16v3h-2.5z"/>`,
  eye: `<path fill-rule="evenodd" d="M12 5C6.5 5 2.7 9 1.5 12c1.2 3 5 7 10.5 7s9.3-4 10.5-7C21.3 9 17.5 5 12 5z${circ(12, 12, 3.4)}"/>`,
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Imágenes para el canvas (blancas por defecto)
const cache = new Map();
export function iconImage(name, color = '#fff') {
  const key = name + color;
  if (cache.has(key)) return cache.get(key);
  const img = new Image();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="${color}" color="${color}">${ICONS[name]}</svg>`;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  cache.set(key, img);
  return img;
}

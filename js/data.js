// Datos estáticos del juego: reglas, potenciadores, habilidades, modos y mapas.

export const VERSION = 1;             // versión del protocolo de red
export const TICK_RATE = 30;          // simulación a 30 ticks por segundo
export const TICK_MS = 1000 / TICK_RATE;
export const SNAP_EVERY = 2;          // el anfitrión envía una instantánea cada 2 ticks (15/s)
export const MAX_PLAYERS = 8;
export const W = 17, H = 13;          // tamaño del tablero en casillas

export const secs = s => Math.round(s * TICK_RATE);

// Tipos de casilla
export const T = { FLOOR: 0, WALL: 1, BLOCK: 2, BURN: 3, FALL: 4 };

// Reglas base
export const RULES = {
  baseBombs: 1, maxBombs: 8,
  baseFire: 2, maxFire: 8,
  baseSpeed: 3.4, speedStep: 0.55, maxSpeedLvl: 5,
  fuse: secs(2.5), shortFuse: secs(1.0),
  flame: secs(0.5), burn: secs(0.5),
  kickSpeed: 7.5,
  respawn: secs(3), spawnInvuln: secs(2), shieldInvuln: secs(1),
  curse: secs(10),
  countdown: secs(3), roundEndGrace: 25, roundOver: secs(3.5),
  suddenEvery: 4,
  frozen: secs(1.5),
};

// Potenciadores
export const ITEM = { NONE: 0, BOMB: 1, FIRE: 2, SPEED: 3, KICK: 4, PIERCE: 5, SHIELD: 6, MAXFIRE: 7, SKULL: 8, COIN: 9 };
export const ITEMS = {
  [ITEM.BOMB]:    { key: 'bomb',    name: 'Bomba extra',  desc: 'Una bomba más a la vez.', weight: 30 },
  [ITEM.FIRE]:    { key: 'fire',    name: 'Más fuego',    desc: 'Las explosiones llegan una casilla más lejos.', weight: 30 },
  [ITEM.SPEED]:   { key: 'speed',   name: 'Velocidad',    desc: 'Corres más.', weight: 18 },
  [ITEM.KICK]:    { key: 'kick',    name: 'Patada',       desc: 'Empuja bombas al chocar con ellas.', weight: 7 },
  [ITEM.PIERCE]:  { key: 'pierce',  name: 'Perforante',   desc: 'Tus explosiones atraviesan bloques.', weight: 5 },
  [ITEM.SHIELD]:  { key: 'shield',  name: 'Escudo',       desc: 'Aguanta un golpe.', weight: 6 },
  [ITEM.MAXFIRE]: { key: 'maxfire', name: 'Fuego total',  desc: 'Alcance de explosión al máximo.', weight: 2 },
  [ITEM.SKULL]:   { key: 'skull',   name: 'Maldición',    desc: 'Un efecto malo durante 10 s. Se contagia al tocar a otro.', weight: 5 },
  [ITEM.COIN]:    { key: 'coin',    name: 'Moneda',       desc: 'Suma al marcador en el modo Botín.', weight: 0 },
};

export const CURSES = ['slow', 'fast', 'reverse', 'diarrhea', 'nobomb', 'shortfuse'];
export const CURSE_NAMES = {
  slow: 'Lentitud', fast: 'Prisa descontrolada', reverse: 'Controles invertidos',
  diarrhea: 'Bombas sin control', nobomb: 'Sin bombas', shortfuse: 'Mecha corta',
};

// Habilidades activas (una por jugador)
export const ABILITY_IDS = ['dash', 'barrier', 'builder', 'ghost', 'detonator', 'frost'];
export const ABILITIES = {
  dash:      { name: 'Impulso',     desc: 'Avanza de golpe hasta 3 casillas.', cd: secs(6) },
  barrier:   { name: 'Barrera',     desc: 'Eres invulnerable durante 1,5 s.', cd: secs(15) },
  builder:   { name: 'Constructor', desc: 'Levanta un bloque delante de ti.', cd: secs(8) },
  ghost:     { name: 'Fantasma',    desc: 'Atraviesas bloques y bombas durante 3 s.', cd: secs(16) },
  detonator: { name: 'Detonador',   desc: 'Haces estallar todas tus bombas al instante.', cd: secs(5) },
  frost:     { name: 'Escarcha',    desc: 'Congelas 1,5 s a los rivales cercanos.', cd: secs(15) },
};

// Modos de juego
export const MODE_IDS = ['classic', 'teams', 'chaos', 'loot', 'zone'];
export const MODES = {
  classic: { name: 'Clásico', desc: 'El último en pie gana la ronda.', rounds: true },
  teams:   { name: 'Equipos', desc: 'Rojos contra azules: gana el último equipo en pie.', rounds: true, teams: true },
  chaos:   { name: 'Caos',    desc: 'Reapareces al caer. Suma derribos antes de que acabe el tiempo.', respawn: true, timed: true },
  loot:    { name: 'Botín',   desc: 'Recoge monedas. Si caes, sueltas la mitad.', respawn: true, timed: true },
  zone:    { name: 'Zona',    desc: 'Quédate solo en la zona para sumar puntos.', respawn: true, timed: true },
};
export const TEAM_NAMES = ['Rojos', 'Azules'];
export const TEAM_COLORS = ['#ff5a4e', '#4aa3ff'];

// Colores de jugador
export const COLORS = [
  { name: 'Rojo', hex: '#ef4b3f' },
  { name: 'Azul', hex: '#3a8dff' },
  { name: 'Verde', hex: '#36c167' },
  { name: 'Amarillo', hex: '#f5c518' },
  { name: 'Morado', hex: '#a866f0' },
  { name: 'Cian', hex: '#25cfd0' },
  { name: 'Rosa', hex: '#ff6fb0' },
  { name: 'Blanco', hex: '#e6eaf0' },
];

export const BOT_NAMES = ['Chispa', 'Mecha', 'Petardo', 'Pólvora', 'Bengala', 'Traca', 'Cohete', 'Detonia', 'Brasa', 'Estopa'];
export const BOT_LEVELS = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };

// Puntos de aparición: cuatro esquinas y, con más de cuatro jugadores, los centros de los lados.
export const SPAWNS = [[1, 1], [15, 11], [15, 1], [1, 11], [8, 1], [8, 11], [1, 6], [15, 6]];
// Zonas candidatas (centro de un área de 3x3) para el modo Zona.
export const ZONES = [[8, 6], [4, 3], [12, 9], [12, 3], [4, 9]];

// Mapas: # muro, + posible bloque, . suelo siempre libre.
export const MAPS = {
  clasico: {
    name: 'Clásico', theme: 'cesped', density: 0.82,
    rows: [
      '#################',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#################',
    ],
  },
  fortaleza: {
    name: 'Fortaleza', theme: 'piedra', density: 0.8,
    rows: [
      '#################',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#+#+###+.+###+#+#',
      '#+++#+++++++#+++#',
      '#+#+.++...++.+#+#',
      '#+++#+++++++#+++#',
      '#+#+###+.+###+#+#',
      '#+++++++++++++++#',
      '#+#+#+#+#+#+#+#+#',
      '#+++++++++++++++#',
      '#################',
    ],
  },
  cruce: {
    name: 'Cruce', theme: 'desierto', density: 0.78,
    rows: [
      '#################',
      '#+++++++.+++++++#',
      '#+##+##+.+##+##+#',
      '#+#+++++.+++++#+#',
      '#+++#+#+.+#+#+++#',
      '#+#+++#+.+#+++#+#',
      '#+++.........+++#',
      '#+#+++#+.+#+++#+#',
      '#+++#+#+.+#+#+++#',
      '#+#+++++.+++++#+#',
      '#+##+##+.+##+##+#',
      '#+++++++.+++++++#',
      '#################',
    ],
  },
  laberinto: {
    name: 'Laberinto', theme: 'hielo', density: 0.72,
    rows: [
      '#################',
      '#+++++++++++++++#',
      '#+#####+#+#####+#',
      '#+++++#+++#+++++#',
      '#+###+#+#+#+###+#',
      '#+#+++++++++++#+#',
      '#+++#+##+##+#+++#',
      '#+#+++++++++++#+#',
      '#+###+#+#+#+###+#',
      '#+++++#+++#+++++#',
      '#+#####+#+#####+#',
      '#+++++++++++++++#',
      '#################',
    ],
  },
  arena: {
    name: 'Volcán', theme: 'volcan', density: 0.7,
    rows: [
      '#################',
      '#+++++++++++++++#',
      '#+#+++#+++#+++#+#',
      '#+++++++++++++++#',
      '#+++#+++#+++#+++#',
      '#+++++++++++++++#',
      '#+#+++#+++#+++#+#',
      '#+++++++++++++++#',
      '#+++#+++#+++#+++#',
      '#+++++++++++++++#',
      '#+#+++#+++#+++#+#',
      '#+++++++++++++++#',
      '#################',
    ],
  },
};
export const MAP_IDS = Object.keys(MAPS);

// Paletas de cada tema (suelo A/B, muro cara/lateral, bloque cara/lateral, detalle)
export const THEMES = {
  cesped:   { floorA: '#5d9e4c', floorB: '#579646', wallTop: '#9aa1ab', wallSide: '#5f6670', blockTop: '#c98b4c', blockSide: '#8a5a2e', detail: '#e9b877', shadow: 'rgba(20,40,10,.35)' },
  piedra:   { floorA: '#8b8478', floorB: '#847d71', wallTop: '#59606b', wallSide: '#383d45', blockTop: '#b9a78a', blockSide: '#7d6f59', detail: '#d8c7a8', shadow: 'rgba(25,20,15,.35)' },
  desierto: { floorA: '#e0b26a', floorB: '#d7a861', wallTop: '#b0673c', wallSide: '#743f22', blockTop: '#f1d6a0', blockSide: '#b8935b', detail: '#fff0c8', shadow: 'rgba(90,50,10,.3)' },
  hielo:    { floorA: '#a8d6ec', floorB: '#9dcce3', wallTop: '#5677a6', wallSide: '#344b70', blockTop: '#eaf7ff', blockSide: '#a2c3da', detail: '#ffffff', shadow: 'rgba(20,50,90,.3)' },
  volcan:   { floorA: '#4c3b38', floorB: '#45352f', wallTop: '#352c2e', wallSide: '#1d1718', blockTop: '#7c4c3a', blockSide: '#4f2e23', detail: '#ff7a2e', shadow: 'rgba(0,0,0,.4)' },
};

export const DEFAULT_SETTINGS = {
  mode: 'classic',
  map: 'clasico',
  rounds: 3,          // rondas para ganar (Clásico y Equipos)
  roundTime: 120,     // segundos antes de la muerte súbita
  matchTime: 180,     // duración (modos con reaparición)
  zoneTarget: 60,     // puntos para ganar en Zona
  powerups: 'normal', // pocos | normal | muchos
  abilities: true,
  friendlyFire: true,
  maxPlayers: 8,
  botLevel: 'normal',
};
export const POWERUP_RATES = { pocos: 0.22, normal: 0.36, muchos: 0.52 };

export function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const pick = (v, ok, def) => (ok(v) ? v : def);
  const int = (v, a, b, def) => (Number.isInteger(v) && v >= a && v <= b ? v : def);
  return {
    mode: pick(s.mode, v => MODE_IDS.includes(v), d.mode),
    map: pick(s.map, v => v === 'random' || MAP_IDS.includes(v), d.map),
    rounds: int(s.rounds, 1, 7, d.rounds),
    roundTime: int(s.roundTime, 30, 600, d.roundTime),
    matchTime: int(s.matchTime, 60, 900, d.matchTime),
    zoneTarget: int(s.zoneTarget, 10, 300, d.zoneTarget),
    powerups: pick(s.powerups, v => v in POWERUP_RATES, d.powerups),
    abilities: typeof s.abilities === 'boolean' ? s.abilities : d.abilities,
    friendlyFire: typeof s.friendlyFire === 'boolean' ? s.friendlyFire : d.friendlyFire,
    maxPlayers: int(s.maxPlayers, 2, MAX_PLAYERS, d.maxPlayers),
    botLevel: pick(s.botLevel, v => v in BOT_LEVELS, d.botLevel),
  };
}

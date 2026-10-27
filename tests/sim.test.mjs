// Partidas completas entre bots en todos los modos y mapas: sin excepciones, con invariantes
// comprobadas en cada tick y estadísticas para ajustar la IA.
// Uso: node tests/sim.test.mjs [partidasPorCombinación]
import { Sim } from '../js/sim.js';
import { Bot, BOT_ABILITIES } from '../js/bots.js';
import { MODE_IDS, MAP_IDS, T, W, TICK_RATE } from '../js/data.js';
import { overlapTiles } from '../js/move.js';
import { mulberry32 } from '../js/util.js';

const reps = Number(process.argv[2] || 1);
let failures = 0;
const stats = {};

function runMatch(mode, map, n, seed, level) {
  const rand = mulberry32(seed * 7 + 1);
  const roster = [];
  for (let i = 0; i < n; i++) {
    roster.push({ slot: i, id: 'b' + i, name: 'Bot' + i, color: i, team: i % 2, ability: BOT_ABILITIES[i % BOT_ABILITIES.length], bot: true });
  }
  const sim = new Sim({ settings: { mode, map, rounds: 2, roundTime: 60, matchTime: 120, zoneTarget: 40 }, roster, seed });
  const bots = roster.map(r => new Bot(r.slot, level, rand));
  const st = { ticks: 0, deaths: 0, suicides: 0, picks: 0, bombs: 0, abil: 0, rounds: 0, falls: 0 };
  const limit = TICK_RATE * 60 * 25;
  while (sim.phase !== 'over' && st.ticks < limit) {
    const inputs = new Map();
    for (const b of bots) inputs.set(b.slot, b.input(sim));
    sim.step(inputs);
    st.ticks++;
    for (const e of sim.drainEvents()) {
      if (e[0] === 'die') { st.deaths++; if (e[1] === e[2]) st.suicides++; }
      if (e[0] === 'pick') st.picks++;
      if (e[0] === 'bomb') st.bombs++;
      if (e[0] === 'abil') st.abil++;
      if (e[0] === 'rend') st.rounds++;
      if (e[0] === 'fall') st.falls++;
    }
    // invariantes
    for (const p of sim.players) {
      if (!p.alive || p.ghost > 0) continue;
      for (const idx of overlapTiles(p.x, p.y)) {
        const t = sim.tiles[idx];
        if (t === T.WALL || t === T.FALL || t === T.BLOCK) {
          throw new Error(`jugador ${p.slot} dentro de casilla sólida ${t} en (${p.x.toFixed(2)},${p.y.toFixed(2)}) tick ${sim.tick}`);
        }
      }
      if (Number.isNaN(p.x) || Number.isNaN(p.y)) throw new Error('posición NaN');
    }
    for (const b of sim.bombs) {
      const idx = Math.floor(b.y) * W + Math.floor(b.x);
      if (sim.bombMap.get(idx) !== b) throw new Error('bombMap desincronizado');
    }
  }
  if (sim.phase !== 'over') throw new Error(`la partida no terminó (${mode}/${map}), fase ${sim.phase}`);
  const snap = JSON.stringify(sim.snapshot(null)).length;
  const delta = JSON.stringify(sim.snapshot(sim.versions())).length;
  return { ...st, snap, delta, results: sim.results() };
}

const t0 = Date.now();
for (const mode of MODE_IDS) {
  for (const map of [...MAP_IDS, 'random']) {
    for (let r = 0; r < reps; r++) {
      const n = [2, 4, 6, 8][(r + map.length) % 4];
      const level = ['easy', 'normal', 'hard'][r % 3];
      try {
        const s = runMatch(mode, map, mode === 'teams' ? Math.max(4, n) : n, 1000 + r * 31 + map.length, level);
        const k = mode;
        stats[k] = stats[k] || { n: 0, ticks: 0, deaths: 0, suicides: 0, picks: 0, bombs: 0, abil: 0, rounds: 0, snap: 0, delta: 0 };
        for (const f of Object.keys(stats[k])) if (f !== 'n') stats[k][f] += s[f] || 0;
        stats[k].n++;
      } catch (e) {
        failures++;
        console.error(`FALLO ${mode}/${map} rep ${r}:`, e.stack || e);
      }
    }
  }
}
for (const [k, s] of Object.entries(stats)) {
  const n = s.n;
  console.log(`${k.padEnd(8)} partidas=${n} durMedia=${(s.ticks / n / TICK_RATE).toFixed(0)}s rondas=${(s.rounds / n).toFixed(1)} muertes=${(s.deaths / n).toFixed(1)} suicidios=${(100 * s.suicides / Math.max(1, s.deaths)).toFixed(0)}% bombas=${(s.bombs / n).toFixed(0)} recogidas=${(s.picks / n).toFixed(1)} habilidades=${(s.abil / n).toFixed(1)} snapCompleta=${(s.snap / n).toFixed(0)}B delta=${(s.delta / n).toFixed(0)}B`);
}
console.log(`${failures ? 'CON FALLOS' : 'OK'} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);

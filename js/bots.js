// IA de los bots. Se ejecuta en el anfitrión y produce la misma entrada que un jugador humano.
import { T, W, H, RULES, ITEM, TICK_RATE } from './data.js';
import { DX, DY, OPP } from './move.js';
import { dangerMap, blastTiles } from './danger.js';
import { speedOf } from './sim.js';

const N = W * H;
const LEVELS = {
  easy:   { think: 9, margin: 7, aggro: 0.5, items: 0.7, ability: 0.25, noise: 3.0, hunt: 0.3 },
  normal: { think: 5, margin: 5, aggro: 1.0, items: 1.0, ability: 0.6, noise: 1.2, hunt: 0.8 },
  hard:   { think: 2, margin: 4, aggro: 1.6, items: 1.2, ability: 1.0, noise: 0.4, hunt: 1.4 },
};
const ITEM_VALUE = {
  [ITEM.BOMB]: 6, [ITEM.FIRE]: 6, [ITEM.SPEED]: 5, [ITEM.KICK]: 2.5, [ITEM.PIERCE]: 3,
  [ITEM.SHIELD]: 5, [ITEM.MAXFIRE]: 8, [ITEM.SKULL]: -99, [ITEM.COIN]: 7,
};
export const BOT_ABILITIES = ['dash', 'barrier', 'ghost', 'detonator', 'frost'];

const NONE = { dir: 0, bomb: false, ability: false };
const tileIdx = p => Math.floor(p.y) * W + Math.floor(p.x);

function dangerFor(sim) {
  if (sim._danger && sim._danger.tick === sim.tick) return sim._danger.map;
  const bombs = sim.bombs.map(b => ({ idx: Math.floor(b.y) * W + Math.floor(b.x), fuse: b.fuse, fire: b.fire, pierce: b.pierce }));
  const map = dangerMap(sim.tiles, bombs, sim.flameT);
  sim._danger = { tick: sim.tick, map, bombs };
  return map;
}

export class Bot {
  constructor(slot, level, rand) {
    this.slot = slot;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.rand = rand;
    this.path = [];
    this.cool = 0;
    this.goal = -1;
    this.bombCount = 0;
    this.stuck = 0;
    this.lastPos = '';
    this.wantBomb = false;
  }

  input(sim) {
    const p = sim.bySlot.get(this.slot);
    if (!p || !p.alive || sim.phase !== 'play') { this.path = []; return NONE; }
    const D = dangerFor(sim);
    const my = tileIdx(p);
    const inDanger = D.start[my] !== Infinity;
    const bombsChanged = sim.bombs.length !== this.bombCount;
    this.bombCount = sim.bombs.length;

    const pos = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    this.stuck = pos === this.lastPos ? this.stuck + 1 : 0;
    this.lastPos = pos;

    let out = { dir: 0, bomb: false, ability: false };
    if (--this.cool <= 0 || bombsChanged || inDanger || this.stuck > 12 || (!this.path.length && this.goal !== my)) {
      this.cool = this.cfg.think + Math.floor(this.rand() * 3);
      out = this.plan(sim, p, D, my, inDanger);
      if (this.stuck > 12) { this.stuck = 0; this.path = this.wander(sim, p, D); }
    }
    out.dir = this.follow(p, my);
    if (p.curse === 'reverse' && out.dir) out.dir = OPP[out.dir];
    return out;
  }

  // ------------------------------------------------------------- planificar
  plan(sim, p, D, my, inDanger) {
    const out = { dir: 0, bomb: false, ability: false };
    const tpt = TICK_RATE / speedOf(p);
    const canAbility = sim.settings.abilities && p.abilityCd <= 0;

    if (inDanger) {
      const r = this.search(sim, p, D, my, tpt, i => D.start[i] === Infinity) ||
        this.search(sim, p, D, my, tpt, i => D.start[i] === Infinity, 0);
      if (r) { this.path = r; this.fleeing = true; this.goal = r.length ? r[r.length - 1] : my; return out; }
      // Si ya venía huyendo, mantener la ruta: quedarse quieto es peor.
      if (this.path.length && this.fleeing) return out;
      // Sin salida: recurrir a la habilidad
      if (canAbility && this.rand() < 0.4 + this.cfg.ability * 0.6) {
        if (p.ability === 'barrier' || p.ability === 'ghost') { out.ability = true; return out; }
        if (p.ability === 'dash') {
          const d = this.dashEscape(sim, p, D, my);
          if (d) { this.path = []; this.forceDir = d; out.ability = true; return out; }
        }
      }
      // Al menos alejarse del peligro más inminente
      const r2 = this.search(sim, p, D, my, tpt, i => D.start[i] > D.start[my] + 20, 0);
      this.path = r2 || [];
      return out;
    }

    this.fleeing = false;
    const canBomb = sim.bombsOf(p.slot) < p.bombs && p.curse !== 'nobomb' && !sim.bombMap.has(my);
    const enemies = sim.players.filter(o => o.alive && sim.isEnemy(p, o));

    // Habilidades ofensivas
    if (canAbility && this.rand() < this.cfg.ability) {
      if (p.ability === 'frost' && enemies.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 2.3 && !o.frozen)) out.ability = true;
      if (p.ability === 'detonator' && this.detonateGood(sim, p, enemies)) out.ability = true;
    }

    // Atacar si hay un rival en la línea de fuego y una ruta de escape
    if (canBomb && enemies.length && this.rand() < 0.35 + 0.4 * this.cfg.aggro) {
      const blast = new Set(blastTiles(sim.tiles, sim.bombMap, my % W, (my / W) | 0, p.fire, p.pierce));
      if (enemies.some(o => blast.has(tileIdx(o)) && !o.invuln)) {
        const esc = this.escapeAfterBomb(sim, p, my, tpt);
        if (esc) { out.bomb = true; out.ability = false; this.fleeing = true; this.path = esc; this.goal = esc[esc.length - 1]; this.cool = 3; return out; }
      }
    }

    // Elegir objetivo
    const res = this.reach(sim, p, D, my, tpt);
    let best = -1, bestScore = 0, bestBomb = false;
    const zone = sim.zone;
    const hunt = sim.modeId === 'chaos' && enemies.length > 0;
    for (let i = 0; i < N; i++) {
      const d = res.dist[i];
      if (d < 0 || D.start[i] !== Infinity) continue;
      let v = 0, bombHere = false;
      const it = sim.items[i];
      if (it) v += (ITEM_VALUE[it] || 0) * this.cfg.items + (it === ITEM.COIN ? sim.itemVal[i] * 2 : 0);
      if (canBomb && !sim.bombMap.has(i)) {
        const tiles = blastTiles(sim.tiles, sim.bombMap, i % W, (i / W) | 0, p.fire, p.pierce);
        let blocks = 0, hitsEnemy = false;
        for (const t of tiles) {
          if (sim.tiles[t] === T.BLOCK) blocks++;
          if (enemies.some(o => tileIdx(o) === t)) hitsEnemy = true;
        }
        if (blocks) { v += blocks * 2.2 * (sim.modeId === 'zone' ? 0.6 : 1); bombHere = true; }
        if (hitsEnemy) { v += (hunt ? 6 : 3.5) * this.cfg.aggro; bombHere = true; }
      }
      if (hunt) {
        // En Caos interesa acercarse a los rivales
        let md = 99;
        for (const o of enemies) md = Math.min(md, Math.abs((i % W) + 0.5 - o.x) + Math.abs(((i / W) | 0) + 0.5 - o.y));
        if (md <= 3) v += (3.2 - md) * 1.4 * this.cfg.hunt;
      }
      if (zone && Math.abs((i % W) - zone.cx) <= 1 && Math.abs(((i / W) | 0) - zone.cy) <= 1) {
        v += 9 + (zone.holder >= 0 && zone.holder !== p.slot ? 3 : 0);
      }
      if (v <= 0) continue;
      const score = v - d * 0.9 + this.rand() * this.cfg.noise;
      if (score > bestScore) { bestScore = score; best = i; bestBomb = bombHere; }
    }

    if (best >= 0) {
      if (best === my) {
        this.goal = my;
        this.path = [];
        if (bestBomb && canBomb) {
          const esc = this.escapeAfterBomb(sim, p, my, tpt);
          if (esc) { out.bomb = true; out.ability = false; this.fleeing = true; this.path = esc; this.goal = esc[esc.length - 1]; this.cool = 3; }
        }
        return out;
      }
      this.goal = best;
      this.path = res.pathTo(best);
      return out;
    }

    // Nada interesante: acercarse a un rival o pasear
    if (enemies.length && this.rand() < 0.5 + 0.3 * this.cfg.hunt) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (res.dist[i] < 0 || D.start[i] !== Infinity) continue;
        let md = Infinity;
        for (const o of enemies) md = Math.min(md, Math.abs((i % W) + 0.5 - o.x) + Math.abs(((i / W) | 0) + 0.5 - o.y));
        const s = md + res.dist[i] * 0.15;
        if (s < bd) { bd = s; bi = i; }
      }
      if (bi >= 0 && bi !== my) { this.goal = bi; this.path = res.pathTo(bi); return out; }
    }
    this.path = this.wander(sim, p, D);
    return out;
  }

  // Búsqueda en anchura respetando los tiempos de peligro.
  // margin: ticks de holgura exigidos antes de que una casilla empiece a arder.
  reach(sim, p, D, my, tpt, ghost = false, margin = this.cfg.margin) {
    const dist = new Int16Array(N).fill(-1);
    const time = new Float32Array(N);
    const parent = new Int16Array(N).fill(-1);
    dist[my] = 0;
    const q = [my];
    const pass = margin > 0 ? 0.6 : 0.35;
    while (q.length) {
      const i = q.shift();
      const x = i % W, y = (i / W) | 0;
      for (let d = 1; d <= 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (dist[j] >= 0) continue;
        const t = sim.tiles[j];
        if (t === T.WALL || t === T.FALL) continue;
        if ((t === T.BLOCK || t === T.BURN) && !ghost) continue;
        if (!ghost && sim.bombMap.has(j)) continue;
        if (sim.items[j] === ITEM.SKULL) continue;
        // Tiempo de llegada: desde la posición real para el primer paso
        const arr = i === my
          ? (Math.abs(p.x - nx - 0.5) + Math.abs(p.y - ny - 0.5)) * tpt
          : time[i] + tpt;
        if (arr + tpt * pass + margin >= D.start[j] && arr - tpt * pass <= D.end[j] + 1) continue;
        dist[j] = dist[i] + 1;
        time[j] = arr;
        parent[j] = i;
        q.push(j);
      }
    }
    return {
      dist,
      pathTo(goal) {
        const out = [];
        let c = goal, guard = 300;
        while (c !== my && c >= 0 && guard-- > 0) { out.push(c); c = parent[c]; }
        return out.reverse();
      },
    };
  }

  search(sim, p, D, my, tpt, ok, margin) {
    const r = this.reach(sim, p, D, my, tpt, p.ghost > 0, margin);
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (r.dist[i] < 0 || !ok(i)) continue;
      if (sim.tiles[i] !== T.FLOOR) continue;
      if (r.dist[i] < bd) { bd = r.dist[i]; best = i; }
    }
    if (best < 0) return null;
    if (best === my) return [];
    return r.pathTo(best);
  }

  escapeAfterBomb(sim, p, my, tpt) {
    const bombs = sim.bombs.map(b => ({ idx: Math.floor(b.y) * W + Math.floor(b.x), fuse: b.fuse, fire: b.fire, pierce: b.pierce }));
    bombs.push({ idx: my, fuse: p.curse === 'shortfuse' ? RULES.shortFuse : RULES.fuse, fire: p.fire, pierce: p.pierce });
    const D2 = dangerMap(sim.tiles, bombs, sim.flameT);
    const r = this.reach(sim, p, D2, my, tpt, false);
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (r.dist[i] <= 0 || D2.start[i] !== Infinity || sim.tiles[i] !== T.FLOOR) continue;
      if (r.dist[i] < bd) { bd = r.dist[i]; best = i; }
    }
    if (best < 0 || bd > 7) return null;
    return r.pathTo(best);
  }

  detonateGood(sim, p, enemies) {
    const mine = sim.bombs.filter(b => b.owner === p.slot);
    if (!mine.length) return false;
    const hit = new Set();
    for (const b of mine) for (const t of blastTiles(sim.tiles, sim.bombMap, Math.floor(b.x), Math.floor(b.y), b.fire, b.pierce)) hit.add(t);
    if (hit.has(tileIdx(p)) && !p.invuln) return false;
    return enemies.some(o => hit.has(tileIdx(o)) && !o.invuln);
  }

  dashEscape(sim, p, D, my) {
    for (const d of [1, 2, 3, 4]) {
      let x = my % W, y = (my / W) | 0;
      for (let r = 1; r <= 3; r++) {
        x += DX[d]; y += DY[d];
        const j = y * W + x;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (sim.tiles[j] !== T.FLOOR || sim.bombMap.has(j)) break;
        if (D.start[j] === Infinity) return d;
      }
    }
    return 0;
  }

  wander(sim, p, D) {
    const my = tileIdx(p);
    const r = this.reach(sim, p, D, my, TICK_RATE / speedOf(p));
    const opts = [];
    for (let i = 0; i < N; i++) if (r.dist[i] > 0 && r.dist[i] < 7 && D.start[i] === Infinity) opts.push(i);
    if (!opts.length) return [];
    const g = opts[Math.floor(this.rand() * opts.length)];
    this.goal = g;
    return r.pathTo(g);
  }

  // ------------------------------------------------------------ moverse
  follow(p, my) {
    if (this.forceDir) { const d = this.forceDir; this.forceDir = 0; return d; }
    while (this.path.length && this.path[0] === my) this.path.shift();
    if (!this.path.length) {
      // centrarse en la casilla actual
      const cx = Math.floor(p.x) + 0.5, cy = Math.floor(p.y) + 0.5;
      if (Math.abs(p.x - cx) > 0.06) return p.x < cx ? 2 : 4;
      if (Math.abs(p.y - cy) > 0.06) return p.y < cy ? 3 : 1;
      return 0;
    }
    const next = this.path[0];
    const dx = (next % W) - (my % W), dy = ((next / W) | 0) - ((my / W) | 0);
    if (Math.abs(dx) + Math.abs(dy) !== 1) { this.path = []; return 0; }
    if (dx > 0) return 2;
    if (dx < 0) return 4;
    if (dy > 0) return 3;
    return 1;
  }
}

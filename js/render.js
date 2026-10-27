// Dibujo del tablero en canvas. Todo es vectorial y procedural: no hay imágenes externas.
import { T, W, H, THEMES, MAPS, ITEM, COLORS, TEAM_COLORS, RULES } from './data.js';
import { iconImage } from './icons.js';
import { PF } from './sim.js';

const N = W * H;
const ITEM_STYLE = {
  [ITEM.BOMB]: { bg: '#4656d8', icon: 'bomb' },
  [ITEM.FIRE]: { bg: '#f0561f', icon: 'fire' },
  [ITEM.SPEED]: { bg: '#18a865', icon: 'speed' },
  [ITEM.KICK]: { bg: '#b8742c', icon: 'kick' },
  [ITEM.PIERCE]: { bg: '#7a4bd6', icon: 'pierce' },
  [ITEM.SHIELD]: { bg: '#1f9fc4', icon: 'shield' },
  [ITEM.MAXFIRE]: { bg: '#d8203a', icon: 'maxfire' },
  [ITEM.SKULL]: { bg: '#3b2348', icon: 'skull' },
};
const BLOCK_STYLE = { cesped: 'crate', piedra: 'brick', desierto: 'adobe', hielo: 'ice', volcan: 'magma' };

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k < 0) { r *= 1 + k; g *= 1 + k; b *= 1 + k; } else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export { shade };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = 40;
    this.static = document.createElement('canvas');
    this.staticKey = '';
    this.particles = [];
    this.falls = new Map();   // idx -> instante de inicio de la caída
    this.shake = 0;
    this.shakeOn = true;
    this.flash = 0;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Math.max(12, Math.floor(Math.min(cssW / W, cssH / H) * dpr));
    if (S === this.S && this.canvas.width === S * W) return;
    this.S = S;
    this.canvas.width = S * W;
    this.canvas.height = S * H;
    this.canvas.style.width = `${(S * W) / dpr}px`;
    this.canvas.style.height = `${(S * H) / dpr}px`;
    this.static.width = S * W;
    this.static.height = S * H;
    this.staticKey = '';
  }

  // ------------------------------------------------------------ capa fija
  buildStatic(v) {
    const S = this.S, ctx = this.static.getContext('2d');
    const th = THEMES[MAPS[v.mapId] ? MAPS[v.mapId].theme : 'cesped'];
    const style = BLOCK_STYLE[MAPS[v.mapId] ? MAPS[v.mapId].theme : 'cesped'];
    ctx.clearRect(0, 0, S * W, S * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.drawFloor(ctx, x, y, th);
    // sombras proyectadas
    ctx.fillStyle = th.shadow;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = this.tileFor(v, y * W + x);
      if (t === T.WALL || t === T.BLOCK || t === T.FALL) ctx.fillRect(x * S + S * 0.18, y * S + S * 0.22, S, S * 0.92);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = this.tileFor(v, y * W + x);
      if (t === T.WALL) this.drawWall(ctx, x, y, th, x === 0 || y === 0 || x === W - 1 || y === H - 1);
      else if (t === T.BLOCK) this.drawBlock(ctx, x * S, y * S, S, th, style, hash(x, y));
      else if (t === T.FALL) this.drawSteel(ctx, x * S, y * S, S);
    }
  }

  tileFor(v, idx) {
    const t = v.tiles[idx];
    if (t === T.FALL && this.falls.has(idx)) return T.FLOOR;
    return t;
  }

  drawFloor(ctx, x, y, th) {
    const S = this.S, px = x * S, py = y * S;
    ctx.fillStyle = (x + y) % 2 ? th.floorA : th.floorB;
    ctx.fillRect(px, py, S, S);
    const h = hash(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    if (th === THEMES.cesped) {
      for (let i = 0; i < 3; i++) {
        const hx = hash(x * 3 + i, y * 7), hy = hash(y * 5 + i, x * 2);
        ctx.fillRect(px + hx * S * 0.8, py + hy * S * 0.8, S * 0.05, S * 0.12);
      }
    } else if (th === THEMES.volcan) {
      if (h < 0.25) {
        ctx.strokeStyle = 'rgba(255,110,40,.35)';
        ctx.lineWidth = Math.max(1, S * 0.03);
        ctx.beginPath();
        ctx.moveTo(px + S * 0.2, py + S * (0.3 + h));
        ctx.lineTo(px + S * 0.5, py + S * 0.5);
        ctx.lineTo(px + S * 0.75, py + S * (0.7 - h));
        ctx.stroke();
      }
    } else if (th === THEMES.hielo) {
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      if (h < 0.4) ctx.fillRect(px + S * 0.15, py + S * 0.2, S * 0.3, S * 0.04);
    } else {
      if (h < 0.5) ctx.fillRect(px + h * S * 0.7, py + hash(y, x) * S * 0.7, S * 0.08, S * 0.08);
    }
  }

  drawWall(ctx, x, y, th, border) {
    const S = this.S, px = x * S, py = y * S, top = S * 0.8;
    ctx.fillStyle = th.wallSide;
    ctx.fillRect(px, py, S, S);
    rr(ctx, px + S * 0.04, py + S * 0.03, S * 0.92, top, S * 0.12);
    ctx.fillStyle = th.wallTop;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillRect(px + S * 0.12, py + S * 0.09, S * 0.76, S * 0.07);
    if (!border) {
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(px + S * 0.18, py + S * 0.45, S * 0.64, S * 0.06);
    }
  }

  drawBlock(ctx, px, py, S, th, style, h, scale = 1) {
    const top = S * 0.78;
    ctx.save();
    if (scale !== 1) { ctx.translate(px + S / 2, py + S / 2); ctx.scale(scale, scale); ctx.translate(-px - S / 2, -py - S / 2); }
    rr(ctx, px + S * 0.06, py + S * 0.06, S * 0.88, S * 0.9, S * 0.1);
    ctx.fillStyle = th.blockSide;
    ctx.fill();
    rr(ctx, px + S * 0.06, py + S * 0.04, S * 0.88, top, S * 0.1);
    ctx.fillStyle = th.blockTop;
    ctx.fill();
    ctx.strokeStyle = th.blockSide;
    ctx.lineWidth = Math.max(1, S * 0.045);
    const x0 = px + S * 0.06, y0 = py + S * 0.04, w = S * 0.88, hh = top;
    ctx.beginPath();
    if (style === 'crate') {
      ctx.rect(x0 + S * 0.1, y0 + S * 0.1, w - S * 0.2, hh - S * 0.2);
      ctx.moveTo(x0 + S * 0.1, y0 + S * 0.1); ctx.lineTo(x0 + w - S * 0.1, y0 + hh - S * 0.1);
    } else if (style === 'brick' || style === 'adobe') {
      const rows = 3;
      for (let i = 1; i < rows; i++) { ctx.moveTo(x0, y0 + (hh * i) / rows); ctx.lineTo(x0 + w, y0 + (hh * i) / rows); }
      for (let i = 0; i < rows; i++) {
        const off = i % 2 ? 0.5 : 0.25;
        ctx.moveTo(x0 + w * off, y0 + (hh * i) / rows); ctx.lineTo(x0 + w * off, y0 + (hh * (i + 1)) / rows);
        if (i % 2 === 0) { ctx.moveTo(x0 + w * 0.75, y0 + (hh * i) / rows); ctx.lineTo(x0 + w * 0.75, y0 + (hh * (i + 1)) / rows); }
      }
    } else if (style === 'ice') {
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.moveTo(x0 + S * 0.18, y0 + S * 0.42); ctx.lineTo(x0 + S * 0.42, y0 + S * 0.16);
      ctx.moveTo(x0 + S * 0.22, y0 + S * 0.58); ctx.lineTo(x0 + S * 0.32, y0 + S * 0.48);
    } else if (style === 'magma') {
      ctx.strokeStyle = th.detail;
      ctx.moveTo(x0 + w * (0.2 + h * 0.2), y0 + S * 0.08); ctx.lineTo(x0 + w * 0.5, y0 + hh * 0.5); ctx.lineTo(x0 + w * (0.8 - h * 0.2), y0 + hh - S * 0.06);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillRect(x0 + S * 0.08, y0 + S * 0.05, w - S * 0.16, S * 0.05);
    ctx.restore();
  }

  drawSteel(ctx, px, py, S) {
    rr(ctx, px + S * 0.02, py + S * 0.02, S * 0.96, S * 0.96, S * 0.08);
    ctx.fillStyle = '#2c3038';
    ctx.fill();
    rr(ctx, px + S * 0.02, py + S * 0.02, S * 0.96, S * 0.78, S * 0.08);
    ctx.fillStyle = '#5c636f';
    ctx.fill();
    // franja de peligro
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + S * 0.08, py + S * 0.3, S * 0.84, S * 0.2);
    ctx.clip();
    ctx.fillStyle = '#ffc21a';
    ctx.fillRect(px, py + S * 0.3, S, S * 0.2);
    ctx.fillStyle = '#23262b';
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      const x = px + i * S * 0.24;
      ctx.moveTo(x, py + S * 0.5); ctx.lineTo(x + S * 0.12, py + S * 0.5); ctx.lineTo(x + S * 0.32, py + S * 0.3); ctx.lineTo(x + S * 0.2, py + S * 0.3);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#8a919c';
    for (const [rx, ry] of [[0.14, 0.12], [0.86, 0.12], [0.14, 0.68], [0.86, 0.68]]) {
      ctx.beginPath(); ctx.arc(px + S * rx, py + S * ry, S * 0.04, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ------------------------------------------------------------- efectos
  addParticles(list) { for (const p of list) this.particles.push(p); }

  burst(x, y, n, opts) {
    const S = 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 2) * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x: x + (Math.random() - 0.5) * (opts.spread || 0.3) * S, y: y + (Math.random() - 0.5) * (opts.spread || 0.3) * S,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0),
        life: 0, max: (opts.life || 0.6) * (0.7 + Math.random() * 0.6), color: opts.colors[i % opts.colors.length],
        size: (opts.size || 0.08) * (0.6 + Math.random() * 0.8), type: opts.type || 'square', grav: opts.grav || 0, drag: opts.drag || 0.9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
      });
    }
  }

  ring(x, y, color, maxR = 1.5, life = 0.5, width = 0.08) {
    this.particles.push({ type: 'ring', x, y, color, life: 0, max: life, maxR, width });
  }

  text(x, y, str, color) {
    this.particles.push({ type: 'text', x, y, vx: 0, vy: -0.9, str, color, life: 0, max: 1.1, grav: 0, drag: 1 });
  }

  fallAt(idx, now) { this.falls.set(idx, now); }
  addShake(v) { if (this.shakeOn) this.shake = Math.min(0.35, this.shake + v); }

  // ------------------------------------------------------------------ dibujo
  draw(v, now, dt) {
    const S = this.S, ctx = this.ctx;
    // fin de animaciones de caída
    for (const [idx, t0] of this.falls) if (now - t0 > 260) this.falls.delete(idx);
    const key = `${v.mapId}|${v.tilesKey}|${this.falls.size ? [...this.falls.keys()].join(',') : ''}|${S}`;
    if (key !== this.staticKey) { this.buildStatic(v); this.staticKey = key; }
    const th = THEMES[MAPS[v.mapId] ? MAPS[v.mapId].theme : 'cesped'];
    const style = BLOCK_STYLE[MAPS[v.mapId] ? MAPS[v.mapId].theme : 'cesped'];

    ctx.save();
    if (this.shake > 0.001) {
      ctx.translate((Math.random() - 0.5) * this.shake * S, (Math.random() - 0.5) * this.shake * S);
      this.shake *= Math.pow(0.02, dt);
    }
    ctx.drawImage(this.static, 0, 0);

    // zona
    if (v.zone) this.drawZone(ctx, v, now);

    // bloques ardiendo
    for (const [idx, t] of v.burns) {
      const x = idx % W, y = (idx / W) | 0;
      const k = t / RULES.burn;
      this.drawBlock(ctx, x * S, y * S, S, th, style, hash(x, y), 0.4 + 0.6 * k);
      ctx.globalAlpha = 0.85 * k;
      ctx.fillStyle = '#ff7a22';
      rr(ctx, x * S + S * 0.1, y * S + S * 0.08, S * 0.8, S * 0.8, S * 0.12);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // potenciadores
    for (let i = 0; i < v.itemList.length; i += 3) this.drawItem(ctx, v.itemList[i], v.itemList[i + 1], now);

    // bombas
    for (const b of v.bombs) this.drawBomb(ctx, b, now, v);

    // llamas
    for (let i = 0; i < v.flames.length; i += 3) this.drawFlame(ctx, v.flames[i], v.flames[i + 1], v.flames[i + 2], now);

    // bloques que caen (muerte súbita)
    for (const [idx, t0] of this.falls) {
      const x = idx % W, y = (idx / W) | 0, k = Math.min(1, (now - t0) / 240);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.3 * k})`;
      ctx.beginPath(); ctx.ellipse(x * S + S / 2, y * S + S * 0.75, S * 0.45 * k, S * 0.2 * k, 0, 0, Math.PI * 2); ctx.fill();
      this.drawSteel(ctx, x * S, y * S - (1 - k * k) * S * 4, S);
    }

    // jugadores (de arriba abajo)
    const ps = v.players.filter(p => p.visible).sort((a, b) => a.y - b.y);
    for (const p of ps) this.drawPlayer(ctx, p, now, v);
    for (const p of ps) this.drawTag(ctx, p, v);

    this.drawParticles(ctx, dt);
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${this.flash})`;
      ctx.fillRect(0, 0, S * W, S * H);
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }
  }

  drawZone(ctx, v, now) {
    const S = this.S, z = v.zone;
    const x = (z.cx - 1) * S, y = (z.cy - 1) * S, w = S * 3;
    const holder = v.players.find(p => p.slot === z.holder);
    const col = holder ? COLORS[holder.color].hex : z.holder === -2 ? '#ff4d4d' : '#ffffff';
    ctx.globalAlpha = z.holder === -2 ? 0.16 + 0.1 * Math.sin(now / 80) : 0.2;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, w);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, S * 0.07);
    ctx.setLineDash([S * 0.3, S * 0.2]);
    ctx.lineDashOffset = -now / 30;
    ctx.strokeRect(x + S * 0.05, y + S * 0.05, w - S * 0.1, w - S * 0.1);
    ctx.restore();
  }

  drawItem(ctx, idx, type, now) {
    const S = this.S, x = (idx % W) * S, y = ((idx / W) | 0) * S;
    const bob = Math.sin(now / 260 + idx) * S * 0.035;
    if (type === ITEM.COIN) {
      const cx = x + S / 2, cy = y + S / 2 + bob, r = S * 0.3, sx = Math.abs(Math.cos(now / 400 + idx)) * 0.6 + 0.4;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(cx, y + S * 0.86, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, 1);
      ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, S * 0.03, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e0a800'; ctx.lineWidth = S * 0.05; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const st = ITEM_STYLE[type];
    if (!st) return;
    const pad = S * 0.12, w = S - pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    rr(ctx, x + pad + S * 0.04, y + pad + S * 0.08, w, w, S * 0.14); ctx.fill();
    ctx.fillStyle = shade(st.bg, -0.35);
    rr(ctx, x + pad, y + pad + bob + S * 0.05, w, w, S * 0.14); ctx.fill();
    ctx.fillStyle = st.bg;
    rr(ctx, x + pad, y + pad + bob, w, w, S * 0.14); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    rr(ctx, x + pad + S * 0.06, y + pad + bob + S * 0.05, w - S * 0.12, S * 0.12, S * 0.06); ctx.fill();
    const img = iconImage(st.icon);
    if (img.complete) ctx.drawImage(img, x + S * 0.24, y + S * 0.24 + bob, S * 0.52, S * 0.52);
  }

  drawBomb(ctx, b, now, v) {
    const S = this.S, cx = b.x * S, cy = b.y * S;
    const fuseLeft = b.fuse;
    const urgent = fuseLeft < 18;
    const pulse = 1 + Math.sin(now / (urgent ? 45 : 110)) * (urgent ? 0.09 : 0.05);
    const r = S * 0.33 * pulse;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.3, r * 0.9, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    const by = cy + S * 0.04;
    ctx.fillStyle = urgent && Math.floor(now / 70) % 2 ? '#7a1f1f' : '#262a35';
    ctx.beginPath(); ctx.arc(cx, by, r, 0, Math.PI * 2); ctx.fill();
    // banda del color del dueño
    const owner = v.players.find(p => p.slot === b.owner);
    if (owner) {
      ctx.strokeStyle = COLORS[owner.color].hex;
      ctx.lineWidth = S * 0.07;
      ctx.beginPath(); ctx.arc(cx, by, r * 0.72, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.35, by - r * 0.35, r * 0.25, 0, Math.PI * 2); ctx.fill();
    // mecha
    ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = S * 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + r * 0.45, by - r * 0.75);
    ctx.quadraticCurveTo(cx + r * 0.9, by - r * 1.25, cx + r * 0.7, by - r * 1.45); ctx.stroke();
    const sp = S * (0.08 + Math.random() * 0.05);
    ctx.fillStyle = Math.random() < 0.5 ? '#fff3b0' : '#ffb02e';
    ctx.beginPath(); ctx.arc(cx + r * 0.7, by - r * 1.45, sp, 0, Math.PI * 2); ctx.fill();
  }

  drawFlame(ctx, idx, mask, t, now) {
    const S = this.S, x = (idx % W) * S, y = ((idx / W) | 0) * S, cx = x + S / 2, cy = y + S / 2;
    const f = t / RULES.flame;
    const k = Math.min(1, f * 1.7) * (0.92 + Math.random() * 0.12);
    const layers = [['#e8401c', 0.86], ['#ff9f1c', 0.6], ['#fff1c1', 0.3]];
    for (const [col, wk] of layers) {
      const w = S * wk * k;
      ctx.fillStyle = col;
      if (mask & 1) ctx.fillRect(cx - w / 2, y - 1, w, S / 2 + 1);
      if (mask & 4) ctx.fillRect(cx - w / 2, cy, w, S / 2 + 1);
      if (mask & 8) ctx.fillRect(x - 1, cy - w / 2, S / 2 + 1, w);
      if (mask & 2) ctx.fillRect(cx, cy - w / 2, S / 2 + 1, w);
      ctx.beginPath(); ctx.arc(cx, cy, (w / 2) * (mask & 16 ? 1.18 : 1), 0, Math.PI * 2); ctx.fill();
    }
    void now;
  }

  drawPlayer(ctx, p, now, v) {
    const S = this.S;
    const col = COLORS[p.color].hex;
    let cx = p.x * S, cy = p.y * S;
    ctx.save();
    if (p.dying >= 0) {
      const k = Math.min(1, p.dying / 0.7);
      ctx.globalAlpha = 1 - k;
      ctx.translate(cx, cy);
      ctx.rotate(k * 4);
      ctx.scale(1 - k * 0.6, 1 - k * 0.6);
      ctx.translate(-cx, -cy);
    } else if (p.flags & PF.GHOST) {
      ctx.globalAlpha = 0.45 + 0.1 * Math.sin(now / 90);
    } else if ((p.flags & PF.INVULN) && !(p.flags & PF.BARRIER) && Math.floor(now / 90) % 2) {
      ctx.globalAlpha = 0.45;
    }
    const walk = p.moving ? Math.sin(now / 70 + p.slot) : 0;
    const bodyY = cy - S * 0.08 - Math.abs(walk) * S * 0.03;
    // sombra y anillo de equipo
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.34, S * 0.3, S * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    if (v.teams) {
      ctx.strokeStyle = TEAM_COLORS[p.team];
      ctx.lineWidth = S * 0.06;
      ctx.beginPath(); ctx.ellipse(cx, cy + S * 0.34, S * 0.36, S * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // pies
    ctx.fillStyle = '#1d2027';
    ctx.beginPath(); ctx.ellipse(cx - S * 0.14, cy + S * 0.3 + walk * S * 0.04, S * 0.1, S * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + S * 0.14, cy + S * 0.3 - walk * S * 0.04, S * 0.1, S * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    // cuerpo
    const r = S * 0.34;
    ctx.fillStyle = '#1d2027';
    ctx.beginPath(); ctx.arc(cx, bodyY, r + S * 0.035, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(cx, bodyY - r, cx, bodyY + r);
    g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, bodyY, r, 0, Math.PI * 2); ctx.fill();
    // aleta superior
    ctx.fillStyle = shade(col, -0.25);
    rr(ctx, cx - S * 0.05, bodyY - r - S * 0.08, S * 0.1, S * 0.12, S * 0.04); ctx.fill();
    // visor
    const dir = p.dir;
    const lookX = dir === 2 ? 1 : dir === 4 ? -1 : 0;
    if (dir !== 1) {
      const vx = cx + lookX * S * 0.07, vy = bodyY - S * 0.04 + (dir === 3 ? S * 0.02 : 0);
      ctx.fillStyle = '#1b1f2a';
      rr(ctx, vx - S * 0.23, vy - S * 0.1, S * 0.46, S * 0.2, S * 0.09); ctx.fill();
      const blink = Math.floor((now + p.slot * 777) / 120) % 31 === 0;
      ctx.fillStyle = p.flags & PF.FROZEN ? '#bfe9ff' : '#8ff6ff';
      const eh = blink ? S * 0.02 : S * 0.1;
      ctx.fillRect(vx - S * 0.13 + lookX * S * 0.04, vy - eh / 2, S * 0.07, eh);
      ctx.fillRect(vx + S * 0.06 + lookX * S * 0.04, vy - eh / 2, S * 0.07, eh);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(cx - S * 0.12, bodyY + S * 0.02, S * 0.24, S * 0.04);
      ctx.fillRect(cx - S * 0.12, bodyY + S * 0.1, S * 0.24, S * 0.04);
    }
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.42, bodyY - r * 0.5, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();

    // efectos
    if (p.dying < 0) {
      if (p.flags & PF.SHIELD) {
        ctx.strokeStyle = 'rgba(120,220,255,.85)';
        ctx.fillStyle = 'rgba(120,220,255,.14)';
        ctx.lineWidth = S * 0.04;
        ctx.beginPath(); ctx.arc(cx, bodyY + S * 0.04, S * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (p.flags & PF.BARRIER) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = S * 0.06;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2 + now / 300;
          const px = cx + Math.cos(a) * S * 0.52, py = bodyY + S * 0.04 + Math.sin(a) * S * 0.52;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      if (p.flags & PF.FROZEN) {
        ctx.fillStyle = 'rgba(190,235,255,.55)';
        rr(ctx, cx - S * 0.42, cy - S * 0.5, S * 0.84, S * 0.9, S * 0.1); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = S * 0.04;
        ctx.beginPath(); ctx.moveTo(cx - S * 0.3, cy - S * 0.2); ctx.lineTo(cx - S * 0.1, cy - S * 0.4); ctx.stroke();
      }
      if (p.curse) {
        const img = iconImage('skull', '#d9a3ff');
        if (img.complete) ctx.drawImage(img, cx - S * 0.15, bodyY - r - S * 0.42 + Math.sin(now / 150) * S * 0.04, S * 0.3, S * 0.3);
      }
    }
    ctx.restore();
  }

  drawTag(ctx, p, v) {
    if (p.dying >= 0 || p.noTag) return;
    const S = this.S;
    const fs = Math.max(9, Math.round(S * 0.24));
    ctx.font = `600 ${fs}px Rubik, system-ui, sans-serif`;
    const txt = p.isMe ? 'Tú' : p.name;
    const w = ctx.measureText(txt).width + fs * 0.8;
    const x = p.x * S - w / 2, y = p.y * S - S * 0.86 - fs;
    ctx.fillStyle = p.isMe ? '#ffc21a' : 'rgba(20,22,28,.7)';
    rr(ctx, x, y, w, fs * 1.35, fs * 0.6); ctx.fill();
    ctx.fillStyle = p.isMe ? '#1b1d22' : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, p.x * S, y + fs * 0.7);
    void v;
  }

  drawParticles(ctx, dt) {
    const S = this.S;
    const keep = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      keep.push(p);
      const k = p.life / p.max;
      if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = S * p.width * (1 - k * 0.5);
        ctx.beginPath(); ctx.arc(p.x * S, p.y * S, p.maxR * S * (0.2 + 0.8 * k), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dr = Math.pow(p.drag, dt * 60);
      p.vx *= dr; p.vy *= dr;
      ctx.globalAlpha = 1 - k * k;
      if (p.type === 'text') {
        ctx.fillStyle = p.color;
        ctx.font = `700 ${Math.round(S * 0.34)}px Rubik, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = S * 0.06; ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(p.str, p.x * S, p.y * S);
        ctx.fillText(p.str, p.x * S, p.y * S);
      } else if (p.type === 'smoke') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x * S, p.y * S, p.size * S * (1 + k * 2), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'trail') {
        ctx.globalAlpha = 0.4 * (1 - k);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x * S, p.y * S, S * 0.32, 0, Math.PI * 2); ctx.fill();
      } else {
        p.rot += p.vr * dt;
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x * S, p.y * S); ctx.rotate(p.rot);
        const s = p.size * S;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    this.particles = keep.length > 600 ? keep.slice(-600) : keep;
  }
}

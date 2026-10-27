// Entrada: teclado, mando y controles táctiles. sample() devuelve la dirección pulsada
// y si se ha pulsado bomba o habilidad desde la última muestra.
const KEY_DIR = {
  ArrowUp: 1, KeyW: 1, ArrowRight: 2, KeyD: 2, ArrowDown: 3, KeyS: 3, ArrowLeft: 4, KeyA: 4,
};
const KEY_BOMB = new Set(['Space', 'KeyJ']);
const KEY_ABILITY = new Set(['ShiftLeft', 'ShiftRight', 'KeyK']);

export class Input {
  constructor() {
    this.held = [];          // pila de direcciones mantenidas (la última manda)
    this.bombPress = 0;
    this.abilityPress = 0;
    this.enabled = true;
    this.touchDir = 0;
    this.padPrev = {};
    this.onPause = null;
    this.onChat = null;
    this.onScores = null;
    this.down = e => this.keyDown(e);
    this.up = e => this.keyUp(e);
    this.blur = () => { this.held = []; this.touchDir = 0; };
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
  }

  typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  keyDown(e) {
    if (!this.enabled || this.typing(e)) return;
    if (e.code === 'Escape') { if (this.onPause) this.onPause(); return; }
    if (e.code === 'Enter' || e.code === 'KeyT') { if (this.onChat) { e.preventDefault(); this.onChat(); } return; }
    if (e.code === 'Tab') { e.preventDefault(); if (this.onScores) this.onScores(true); return; }
    const d = KEY_DIR[e.code];
    if (d) {
      e.preventDefault();
      if (!this.held.includes(d)) this.held.push(d);
      return;
    }
    if (KEY_BOMB.has(e.code)) { e.preventDefault(); if (!e.repeat) this.bombPress++; return; }
    if (KEY_ABILITY.has(e.code)) { e.preventDefault(); if (!e.repeat) this.abilityPress++; }
  }

  keyUp(e) {
    if (e.code === 'Tab' && this.onScores) this.onScores(false);
    const d = KEY_DIR[e.code];
    if (d) this.held = this.held.filter(x => x !== d);
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const edge = i => { const v = b(i), was = this.padPrev[i]; this.padPrev[i] = v; return v && !was; };
      let dir = 0;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.45) dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 2 : 4) : (ay > 0 ? 3 : 1);
      if (b(12)) dir = 1; else if (b(13)) dir = 3; else if (b(14)) dir = 4; else if (b(15)) dir = 2;
      if (edge(0)) this.bombPress++;
      if (edge(1) || edge(2)) this.abilityPress++;
      if (edge(9) && this.onPause) this.onPause();
      return dir;
    }
    return 0;
  }

  sample() {
    const pad = this.pollPad();
    const dir = !this.enabled ? 0 : this.touchDir || (this.held.length ? this.held[this.held.length - 1] : 0) || pad;
    const out = { dir, bomb: this.enabled && this.bombPress > 0, ability: this.enabled && this.abilityPress > 0 };
    this.bombPress = 0;
    this.abilityPress = 0;
    return out;
  }

  // Controles táctiles: joystick a la izquierda y botones a la derecha.
  bindTouch(root) {
    const stick = root.querySelector('.stick');
    const knob = root.querySelector('.knob');
    const bomb = root.querySelector('.tbtn-bomb');
    const ability = root.querySelector('.tbtn-ability');
    let stickId = null, ox = 0, oy = 0;
    const zone = root.querySelector('.stick-zone');
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    zone.addEventListener('pointerdown', e => {
      if (stickId !== null) return;
      stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      stick.style.left = `${e.clientX - r.left}px`;
      stick.style.top = `${e.clientY - r.top}px`;
      stick.classList.add('on');
      setKnob(0, 0);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== stickId) return;
      const dx = e.clientX - ox, dy = e.clientY - oy;
      const len = Math.hypot(dx, dy), max = 46;
      const k = len > max ? max / len : 1;
      setKnob(dx * k, dy * k);
      if (len < 14) this.touchDir = 0;
      else this.touchDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1);
    });
    const end = e => {
      if (e.pointerId !== stickId) return;
      stickId = null; this.touchDir = 0;
      stick.classList.remove('on');
      setKnob(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    const press = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); el.classList.add('down'); });
    const release = el => ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, () => el.classList.remove('down')));
    press(bomb, () => { if (this.enabled) this.bombPress++; });
    press(ability, () => { if (this.enabled) this.abilityPress++; });
    release(bomb); release(ability);
  }

  destroy() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
  }
}

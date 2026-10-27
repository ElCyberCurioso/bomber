// Sonido sintetizado con WebAudio: no hay archivos de audio que descargar.
const mtof = m => 440 * 2 ** ((m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.7;
    this.musicVol = 0.3;
    this.musicOn = false;
    this.last = {};
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    this.mus = this.ctx.createGain();
    this.mus.gain.value = this.musicVol;
    this.mus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicOn) this.startMusic();
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music;
    if (this.sfx) this.sfx.gain.value = sfx;
    if (this.mus) this.mus.gain.value = music;
  }

  // ------------------------------------------------------------- primitivas
  tone(type, f0, f1, dur, vol, when = 0, out = this.sfx) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, vol, filter, f0, f1, when = 0, q = 0.8, out = this.sfx) {
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = filter; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    // evita saturar con decenas de sonidos iguales en el mismo instante
    if (this.last[name] && now - this.last[name] < 35) return;
    this.last[name] = now;
    const v = Math.max(0.05, Math.min(1, vol));
    switch (name) {
      case 'place': this.tone('sine', 300, 90, 0.12, 0.5 * v); this.noise(0.03, 0.2 * v, 'highpass', 3000); break;
      case 'boom':
        this.noise(0.7, 0.75 * v, 'lowpass', 2200, 120, 0, 0.7);
        this.tone('sine', 110, 38, 0.45, 0.8 * v);
        break;
      case 'pick': this.tone('square', 660, 660, 0.06, 0.18 * v); this.tone('square', 990, 990, 0.09, 0.18 * v, 0.06); break;
      case 'coin': this.tone('square', 988, 988, 0.05, 0.16 * v); this.tone('square', 1319, 1319, 0.14, 0.16 * v, 0.05); break;
      case 'die': this.tone('sawtooth', 520, 70, 0.55, 0.3 * v); this.noise(0.3, 0.2 * v, 'bandpass', 900, 200); break;
      case 'tick': this.tone('square', 440, 440, 0.1, 0.2 * v); break;
      case 'go': this.tone('square', 880, 880, 0.28, 0.22 * v); this.tone('square', 1320, 1320, 0.28, 0.12 * v); break;
      case 'dash': this.noise(0.22, 0.4 * v, 'bandpass', 600, 3200, 0, 1.5); break;
      case 'barrier': [523, 659, 784].forEach((f, i) => this.tone('sine', f, f * 1.01, 0.5, 0.14 * v, i * 0.03)); break;
      case 'builder': this.tone('square', 160, 120, 0.1, 0.3 * v); this.noise(0.08, 0.3 * v, 'lowpass', 800); break;
      case 'ghost': this.tone('sine', 300, 620, 0.5, 0.2 * v); this.tone('sine', 306, 600, 0.5, 0.14 * v); break;
      case 'detonator': this.tone('square', 1200, 1200, 0.04, 0.2 * v); this.tone('square', 1600, 1600, 0.05, 0.2 * v, 0.06); break;
      case 'frost': [2093, 1760, 1568, 1319].forEach((f, i) => this.tone('sine', f, f, 0.2, 0.12 * v, i * 0.05)); this.noise(0.4, 0.15 * v, 'highpass', 5000); break;
      case 'kick': this.noise(0.06, 0.4 * v, 'bandpass', 1400); this.tone('sine', 200, 120, 0.06, 0.3 * v); break;
      case 'curse': [440, 415, 370, 330].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.2 * v, i * 0.08)); break;
      case 'shield': this.noise(0.25, 0.3 * v, 'highpass', 4000, 9000); this.tone('triangle', 1400, 700, 0.2, 0.15 * v); break;
      case 'fall': this.tone('sine', 90, 40, 0.25, 0.5 * v); this.noise(0.15, 0.25 * v, 'lowpass', 500); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone('square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.18, 0.16 * v, i * 0.2); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.16, 0.16 * v, i * 0.1)); break;
      case 'fail': this.tone('square', 120, 100, 0.12, 0.2 * v); break;
      case 'click': this.tone('square', 900, 900, 0.03, 0.08 * v); break;
      case 'join': this.tone('triangle', 660, 660, 0.08, 0.15 * v); this.tone('triangle', 880, 880, 0.1, 0.15 * v, 0.08); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ música
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic(); else this.stopMusic();
  }

  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    const bpm = 132, step = 60 / bpm / 4;
    // La menor – Fa – Do – Sol
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    let n = 0;
    let next = this.ctx.currentTime + 0.1;
    const schedule = () => {
      const c = this.ctx;
      while (next < c.currentTime + 0.25) {
        const bar = Math.floor(n / 16) % 4, s = n % 16;
        const ch = chords[bar];
        const when = next - c.currentTime;
        if ([0, 6, 8, 14].includes(s)) this.tone('triangle', mtof(ch[0] - 24), mtof(ch[0] - 24), step * 1.8, 0.35, when, this.mus);
        const arp = ch[[0, 1, 2, 1][s % 4]] + (s >= 8 ? 12 : 0);
        this.tone('square', mtof(arp + 12), mtof(arp + 12), step * 0.7, 0.045, when, this.mus);
        if (s % 8 === 0) this.tone('sine', 120, 45, 0.18, 0.4, when, this.mus);
        if (s % 8 === 4) this.noise(0.12, 0.12, 'bandpass', 1800, 1200, when, 0.8, this.mus);
        if (s % 2 === 1) this.noise(0.03, 0.05, 'highpass', 7000, 0, when, 0.8, this.mus);
        next += step;
        n++;
      }
    };
    this.musicTimer = setInterval(schedule, 60);
    schedule();
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const sound = new Sound();

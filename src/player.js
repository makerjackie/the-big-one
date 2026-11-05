// Live player: the film is rendered in real time; the synthesized score is the master clock.
export class Player {
  constructor({ renderAt, canvas, DURATION, still, start, makeScore }) {
    this.renderAt = renderAt; this.canvas = canvas; this.D = DURATION; this.makeScore = makeScore;
    this.t = start || 0; this.playing = false; this.ctx = null; this.buf = null; this.src = null;
    this.ui = document.getElementById('ui');
    this.btn = document.getElementById('play');
    this.bar = document.getElementById('bar');
    this.fill = document.getElementById('fill');
    this.msg = document.getElementById('msg');
    if (still) { this.ui.style.display = 'none'; renderAt(this.t); return; }
    renderAt(this.t > 0 ? this.t : 5.6);   // poster: the robot dozing
    this.btn.addEventListener('click', () => this.start());
    canvas.addEventListener('click', () => (this.ctx ? this.toggle() : this.start()));
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.ctx ? this.toggle() : this.start(); }
      if (e.code === 'KeyR') this.seek(0);
      if (e.code === 'KeyF') this.fullscreen();
      if (e.code === 'ArrowRight') this.seek(this.t + 2);
      if (e.code === 'ArrowLeft') this.seek(this.t - 2);
    });
    this.bar.addEventListener('pointerdown', (e) => {
      const set = (ev) => { const r = this.bar.getBoundingClientRect(); this.seek(((ev.clientX - r.left) / r.width) * this.D); };
      set(e);
      const mv = (ev) => set(ev), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    const loop = () => {
      if (this.playing) {
        this.t = this.ctx.currentTime - this.t0;
        if (this.t >= this.D) { this.t = this.D - 1e-3; this.pause(); this.btn.textContent = '↻ REPLAY'; this.ui.classList.remove('hidden'); }
        this.renderAt(this.t);
      }
      this.fill.style.width = `${(this.t / this.D) * 100}%`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  fullscreen() { const el = document.documentElement; if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); }
  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.msg.textContent = 'synthesizing the score…';
      this.btn.disabled = true;
      await new Promise((r) => setTimeout(r, 30));
      if (this.makeScore) {
        const { L, R } = await this.makeScore(this.ctx.sampleRate);
        this.buf = this.ctx.createBuffer(2, L.length, this.ctx.sampleRate);
        this.buf.copyToChannel(L, 0); this.buf.copyToChannel(R, 1);
      }
      this.btn.disabled = false; this.msg.textContent = '';
    }
    if (this.t >= this.D - 0.01) this.t = 0;
    this.ui.classList.add('hidden');
    this.play();
  }
  play() {
    this.ctx.resume();
    if (this.buf) {
      this.src = this.ctx.createBufferSource();
      this.src.buffer = this.buf; this.src.connect(this.ctx.destination);
      this.src.start(0, this.t);
    }
    this.t0 = this.ctx.currentTime - this.t;
    this.playing = true;
  }
  pause() { if (this.src) { try { this.src.stop(); } catch (e) { /* stopped */ } this.src = null; } this.playing = false; }
  toggle() { if (this.playing) this.pause(); else { if (this.t >= this.D - 0.01) this.t = 0; this.play(); } }
  seek(t) {
    this.t = Math.max(0, Math.min(this.D - 1e-3, t));
    if (this.playing) { this.pause(); this.play(); } else this.renderAt(this.t);
  }
}

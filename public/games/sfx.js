// StudyArcade shared sound engine — all SFX synthesized with Web Audio, zero audio files.
// Usage: <script src="sfx.js"></script>, then SFX.play('correct'), SFX.renderBtn() on load.
(function(){
  const SFX = {
    on: (function(){ try { return localStorage.getItem('sa_sound') !== 'off'; } catch(e){ return true; } })(),
    ctx: null,
    _nb: null,
    ensure(){
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type, vol, when, slideTo){
      type = type || 'sine'; vol = vol || 0.2; when = when || 0;
      const ctx = this.ctx, t = ctx.currentTime + when;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    noise(dur, vol, when, filterFreq){
      vol = vol || 0.2; when = when || 0; filterFreq = filterFreq || 1500;
      const ctx = this.ctx, t = ctx.currentTime + when;
      if (!this._nb) {
        const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this._nb = b;
      }
      const s = ctx.createBufferSource(); s.buffer = this._nb; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(ctx.destination);
      s.start(t); s.stop(t + dur + 0.05);
    },
    play(name){
      if (!this.on) return;
      const ctx = this.ensure();
      if (!ctx) return;
      try {
        switch(name){
          case 'correct': // bright two-note ding
            this.tone(660, 0.12, 'triangle', 0.22); this.tone(880, 0.18, 'triangle', 0.22, 0.09); break;
          case 'wrong': // low buzz
            this.tone(160, 0.25, 'sawtooth', 0.16, 0, 110); break;
          case 'pop': // balloon burst
            this.noise(0.09, 0.28, 0, 2600); this.tone(480, 0.1, 'square', 0.1, 0, 180); break;
          case 'explode': // asteroid destroyed
            this.noise(0.4, 0.3, 0, 420); this.tone(95, 0.4, 'sine', 0.24, 0, 42); break;
          case 'click':
            this.tone(800, 0.05, 'square', 0.1); break;
          case 'flip': // card flip
            this.noise(0.1, 0.12, 0, 2200); break;
          case 'levelup': // ascending arpeggio
            [523, 659, 784, 1047].forEach((fr, i) => this.tone(fr, 0.14, 'triangle', 0.2, i * 0.09)); break;
          case 'tick':
            this.tone(1050, 0.04, 'sine', 0.12); break;
          case 'whoosh': // thrown card
            this.noise(0.25, 0.14, 0, 1100); break;
          case 'miss': // card missed the bins
            this.tone(420, 0.22, 'sine', 0.15, 0, 140); break;
          case 'key': // typing keystroke
            this.noise(0.03, 0.1, 0, 4200); break;
          case 'hint':
            this.tone(1200, 0.1, 'sine', 0.12); this.tone(1600, 0.12, 'sine', 0.1, 0.08); break;
          case 'damage': // boss takes a hit
            this.tone(220, 0.12, 'square', 0.12, 0, 120); break;
          case 'win':
            [523, 659, 784, 1047, 1319].forEach((fr, i) => this.tone(fr, 0.2, 'triangle', 0.2, i * 0.1)); break;
          case 'lose':
            [392, 330, 262, 196].forEach((fr, i) => this.tone(fr, 0.24, 'sawtooth', 0.13, i * 0.13)); break;
        }
      } catch(e){ /* audio glitches must never break gameplay */ }
    },
    toggle(){
      this.on = !this.on;
      try { localStorage.setItem('sa_sound', this.on ? 'on' : 'off'); } catch(e){}
      this.renderBtn();
      if (this.on) this.play('click');
    },
    renderBtn(){
      let b = document.getElementById('sfxbtn');
      if (!b) {
        b = document.createElement('button');
        b.id = 'sfxbtn';
        b.title = 'Toggle sound';
        b.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;width:42px;height:42px;border-radius:50%;border:1px solid #3a4488;background:#1d2347cc;font-size:1.15rem;cursor:pointer;backdrop-filter:blur(4px);';
        b.addEventListener('click', (e) => { e.stopPropagation(); SFX.toggle(); });
        document.body.appendChild(b);
      }
      b.textContent = this.on ? '🔊' : '🔇';
    }
  };
  // Mobile/autoplay: unlock the audio context on the first user gesture.
  const unlock = () => { if (SFX.on) SFX.ensure(); };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SFX.renderBtn());
  else SFX.renderBtn();
  window.SFX = SFX;
})();

// Synthesized sounds, WebAudio only — no audio files, no network. Everything is guarded:
// if the browser has no AudioContext or the user never clicked, sounds are silent.
export function createSounds() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function noiseBurst(duration, filterFreq, gain, type = 'lowpass') {
    const ac = ensure();
    if (!ac || muted) return;
    try {
      const length = Math.max(1, Math.floor(ac.sampleRate * duration));
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(master);
      src.start();
    } catch { /* silent */ }
  }

  function tone(freq, duration, gain, type = 'sine', when = 0, slideTo = 0) {
    const ac = ensure();
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + when;
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch { /* silent */ }
  }

  return {
    unlock() { ensure(); },
    setMuted(value) { muted = value; },
    shoot(kind = 'rifle') {
      if (kind === 'pistol') { noiseBurst(0.07, 1800, 0.5); tone(180, 0.07, 0.25, 'square', 0, 60); }
      else if (kind === 'smg') { noiseBurst(0.05, 2400, 0.4); tone(220, 0.05, 0.2, 'square', 0, 90); }
      else { noiseBurst(0.09, 1200, 0.6); tone(140, 0.1, 0.3, 'square', 0, 50); }
    },
    enemyShoot() { noiseBurst(0.07, 900, 0.18); },
    hit() { tone(1250, 0.06, 0.25, 'square'); },
    kill() { tone(880, 0.08, 0.3, 'square'); tone(1320, 0.12, 0.3, 'square', 0.08); },
    hurt() { tone(110, 0.18, 0.4, 'sawtooth', 0, 55); noiseBurst(0.12, 400, 0.25); },
    reload() { tone(700, 0.05, 0.2, 'square'); tone(500, 0.05, 0.2, 'square', 0.22); },
    buy() { tone(990, 0.07, 0.25, 'sine'); tone(1480, 0.1, 0.25, 'sine', 0.07); },
    deny() { tone(220, 0.12, 0.25, 'square', 0, 160); },
    roundStart() { tone(440, 0.1, 0.25, 'square'); tone(660, 0.14, 0.25, 'square', 0.1); },
    roundWin() { tone(523, 0.12, 0.3, 'square'); tone(659, 0.12, 0.3, 'square', 0.12); tone(784, 0.22, 0.3, 'square', 0.24); },
    roundLose() { tone(392, 0.16, 0.3, 'sawtooth'); tone(311, 0.24, 0.3, 'sawtooth', 0.16); },
    click() { tone(900, 0.04, 0.15, 'square'); },
  };
}

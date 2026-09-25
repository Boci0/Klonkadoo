// ============================================================
// SoundEngine — procedural chiptune audio (Web Audio, no files).
//
//   SFX:   layered square/triangle/noise voices through a shared
//          bus with a compressor, so hits punch without clipping.
//   Music: a tiny step sequencer (bass + arpeggio + hats) with
//          per-screen tracks: menu, map, battle, boss.
//
// Settings persist in localStorage: sfx on/off, music on/off.
// ============================================================

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

// Chord roots (MIDI) + minor/major flag per bar; arps use chord tones
const TRACKS = {
  menu: { bpm: 96, bars: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], lead: [0, 7, 12, 7, 3, 7, 12, 15], hats: false, bassEvery: 4 },
  map: { bpm: 108, bars: [[50, 'm'], [58, 'M'], [53, 'M'], [48, 'M']], lead: [0, 3, 7, 12, 7, 3, 0, 7], hats: true, bassEvery: 4 },
  battle: { bpm: 140, bars: [[52, 'm'], [48, 'M'], [50, 'M'], [47, 'M']], lead: [0, 12, 7, 12, 3, 12, 7, 15], hats: true, bassEvery: 2 },
  boss: { bpm: 150, bars: [[48, 'm'], [44, 'M'], [46, 'M'], [43, 'M']], lead: [0, 12, 3, 12, 7, 12, 3, 15], hats: true, bassEvery: 1 },
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = this._readSetting('slingshot-sfx', localStorage.getItem('slingshot-sound-muted') !== 'true');
    this.musicOn = this._readSetting('slingshot-music', true);
    this.volume = 0.5;
    this._track = null; // requested track name
    this._lastPlayed = {}; // sound name → last start time (ms), for rate limiting
    this._seq = null; // running sequencer state
  }

  // Legacy flag used around the codebase: true = all audio off
  get muted() {
    return !this.sfxOn;
  }

  _readSetting(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === 'on';
    } catch (_) {
      return fallback;
    }
  }

  _writeSetting(key, on) {
    try {
      localStorage.setItem(key, on ? 'on' : 'off');
    } catch (_) {}
  }

  _init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    // Master chain: sfx + music → compressor → out
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volume;
    this.sfxBus.connect(this.comp);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.16;
    this.musicBus.connect(this.comp);

    // Shared white-noise buffer for hits, whooshes and hats
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Call from any user gesture: browsers only start audio after one. */
  unlock() {
    this._init();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this._track && !this._seq) this._startSequencer(this._track);
  }

  _ready() {
    if (!this.sfxOn) return false;
    this.unlock();
    return !!this.ctx;
  }

  /**
   * Rate limit: false if `name` already played within `ms`. Stops rapid
   * repeated collisions (a ball rattling in a corner) from stacking up.
   */
  _throttle(name, ms) {
    const now = performance.now();
    if (now - (this._lastPlayed[name] || 0) < ms) return false;
    this._lastPlayed[name] = now;
    return true;
  }

  // ---------- Settings ----------

  setSfx(on) {
    this.sfxOn = on;
    this._writeSetting('slingshot-sfx', on);
  }

  setMusic(on) {
    this.musicOn = on;
    this._writeSetting('slingshot-music', on);
    if (on) this.playMusic(this._track);
    else this._stopSequencer();
  }

  /** Old single toggle: flips all audio. */
  toggleMute() {
    const on = !this.sfxOn;
    this.setSfx(on);
    this.setMusic(on);
    return !on;
  }

  // ---------- Voices ----------

  _tone({ type = 'square', freq, to, dur, vol, at = 0, bus }) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise({ dur, vol, filter = 'lowpass', freq = 2000, to, at = 0, bus }) {
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- SFX (names kept from the original API) ----------

  playUI(freq = 880, duration = 0.05) {
    if (!this._ready()) return;
    this._tone({ type: 'square', freq, to: freq * 1.5, dur: duration, vol: 0.12 });
  }

  playLaunch(powerPct = 0.5) {
    if (!this._ready()) return;
    const p = Math.max(0.2, Math.min(1.5, powerPct));
    this._noise({ dur: 0.22, vol: 0.35 * p, filter: 'bandpass', freq: 600, to: 3000 });
    this._tone({ type: 'square', freq: 220 + p * 200, to: 900 + p * 400, dur: 0.12, vol: 0.12 });
  }

  playImpact(force = 1.0) {
    if (!this._ready() || !this._throttle('impact', 90)) return;
    const f = Math.max(0.3, Math.min(2, force));
    this._tone({ type: 'triangle', freq: 160 + f * 40, to: 40, dur: 0.18 + f * 0.05, vol: 0.5 + f * 0.2 });
    this._noise({ dur: 0.08 + f * 0.05, vol: 0.3 + f * 0.15, freq: 1800 + f * 1200, to: 200 });
  }

  playWallBounce() {
    if (!this._ready() || !this._throttle('wall', 120)) return;
    this._tone({ type: 'square', freq: 660, to: 330, dur: 0.07, vol: 0.12 });
  }

  playAbility(type = 'overdrive') {
    if (!this._ready() || !this._throttle(`ability-${type}`, 100)) return;
    if (type === 'overdrive') {
      [0, 4, 7, 12].forEach((n, i) => this._tone({ type: 'sawtooth', freq: NOTE(64 + n), dur: 0.1, vol: 0.12, at: i * 0.045 }));
    } else {
      this._tone({ type: 'square', freq: 300, to: 900, dur: 0.18, vol: 0.14 });
      this._noise({ dur: 0.2, vol: 0.12, filter: 'highpass', freq: 3000 });
    }
  }

  playDefeat() {
    if (!this._ready() || !this._throttle('defeat', 150)) return;
    this._noise({ dur: 0.5, vol: 0.55, freq: 2500, to: 80 });
    this._tone({ type: 'triangle', freq: 120, to: 30, dur: 0.45, vol: 0.6 });
  }

  playVictory() {
    if (!this._ready()) return;
    [72, 76, 79, 84, 79, 84].forEach((n, i) => this._tone({ type: 'square', freq: NOTE(n), dur: i === 5 ? 0.4 : 0.12, vol: 0.14, at: i * 0.09 }));
    [48, 55, 60].forEach((n, i) => this._tone({ type: 'triangle', freq: NOTE(n), dur: 0.3, vol: 0.25, at: i * 0.18 }));
  }

  /** Named one-shots for everything else. */
  play(name) {
    if (!this._ready() || !this._throttle(name, 60)) return;
    switch (name) {
      case 'hurt':
        this._tone({ type: 'square', freq: 400, to: 90, dur: 0.18, vol: 0.18 });
        break;
      case 'lose':
        [67, 63, 60, 55].forEach((n, i) => this._tone({ type: 'square', freq: NOTE(n), dur: i === 3 ? 0.5 : 0.16, vol: 0.13, at: i * 0.16 }));
        break;
      case 'confirm':
        this._tone({ type: 'square', freq: NOTE(76), dur: 0.06, vol: 0.12 });
        this._tone({ type: 'square', freq: NOTE(83), dur: 0.1, vol: 0.12, at: 0.06 });
        break;
      case 'error':
        this._tone({ type: 'square', freq: 180, dur: 0.09, vol: 0.14 });
        this._tone({ type: 'square', freq: 140, dur: 0.12, vol: 0.14, at: 0.1 });
        break;
      case 'select':
        this._tone({ type: 'triangle', freq: NOTE(69), to: NOTE(81), dur: 0.08, vol: 0.2 });
        break;
      case 'coin':
        this._tone({ type: 'square', freq: NOTE(83), dur: 0.05, vol: 0.12 });
        this._tone({ type: 'square', freq: NOTE(88), dur: 0.14, vol: 0.12, at: 0.05 });
        break;
      case 'heal':
        [60, 64, 67, 72].forEach((n, i) => this._tone({ type: 'triangle', freq: NOTE(n + 12), dur: 0.12, vol: 0.18, at: i * 0.05 }));
        break;
      case 'retreat':
        this._noise({ dur: 0.3, vol: 0.2, filter: 'bandpass', freq: 3000, to: 400 });
        this._tone({ type: 'square', freq: 500, to: 150, dur: 0.25, vol: 0.1 });
        break;
      case 'alarm':
        // Two-tone siren, three times
        for (let i = 0; i < 6; i++) {
          this._tone({ type: 'square', freq: i % 2 ? 440 : 660, dur: 0.18, vol: 0.12, at: i * 0.2 });
        }
        break;
      case 'step':
        this._tone({ type: 'triangle', freq: 200, to: 120, dur: 0.06, vol: 0.2 });
        break;
      default:
        this.playUI();
    }
  }

  // ---------- Music ----------

  /** Switch background track ('menu' | 'map' | 'battle' | 'boss' | null). */
  playMusic(name) {
    if (name === this._track && this._seq) return;
    this._track = name;
    this._stopSequencer();
    if (!name || !this.musicOn || !this.ctx) return; // starts on unlock()
    this._startSequencer(name);
  }

  _startSequencer(name) {
    const track = TRACKS[name];
    if (!track || !this.musicOn || !this.ctx) return;
    const stepDur = 60 / track.bpm / 2; // eighth notes
    const seq = { track, step: 0, next: this.ctx.currentTime + 0.1, stepDur };
    seq.timer = setInterval(() => this._schedule(seq), 25);
    this._seq = seq;
  }

  _stopSequencer() {
    if (this._seq) clearInterval(this._seq.timer);
    this._seq = null;
  }

  _schedule(seq) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ahead = this.ctx.currentTime + 0.12;
    while (seq.next < ahead) {
      this._playStep(seq, seq.step, seq.next - this.ctx.currentTime);
      seq.step = (seq.step + 1) % (seq.track.bars.length * 8);
      seq.next += seq.stepDur;
    }
  }

  _playStep(seq, step, at) {
    const { track, stepDur } = seq;
    const [root, quality] = track.bars[Math.floor(step / 8)];
    const i = step % 8;
    const bus = this.musicBus;
    // Arpeggio lead (minor/major third adjusts to the chord)
    let n = track.lead[i];
    if (quality === 'M' && (n === 3 || n === 15)) n += 1;
    this._tone({ type: 'square', freq: NOTE(root + 12 + n), dur: stepDur * 0.8, vol: 0.18, at, bus });
    // Bass
    if (i % track.bassEvery === 0) {
      this._tone({ type: 'triangle', freq: NOTE(root - 12), dur: stepDur * track.bassEvery * 0.9, vol: 0.55, at, bus });
    }
    // Hats + kick
    if (track.hats) {
      this._noise({ dur: 0.03, vol: i % 2 ? 0.08 : 0.14, filter: 'highpass', freq: 7000, at, bus });
      if (i % 4 === 0) this._tone({ type: 'sine', freq: 150, to: 40, dur: 0.12, vol: 0.7, at, bus });
    }
  }
}

export const soundEngine = new SoundEngine();

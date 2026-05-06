/**
 * AudioEngine — Spatial Audio + Engine Sound Synthesis
 * Uses Web Audio API to synthesize:
 *  - Engine loops (RPM-driven pitch)
 *  - Anti-lag pops (Group B)
 *  - Turbo flutter (BOV on lift-off)
 *  - Straight-cut gear whine (DTM)
 *  - Tire squeal / smoke
 *  - Wind rush at 200+ km/h (binaural)
 *  - Police scanner crackle
 *  - Race event SFX
 */

export class AudioEngine {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this._engineOsc  = null;
    this._engineGain = null;
    this._currentRPM = 1000;
    this._targetRPM  = 1000;
    this._currentSound = null;
    this._sounds     = {};
    this._muted      = false;
  }

  async init() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this._ctx.state === 'suspended') {
        // Resume on first user gesture
        const resume = () => { this._ctx.resume(); document.removeEventListener('touchstart', resume); };
        document.addEventListener('touchstart', resume);
      }
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 0.85;
      this._masterGain.connect(this._ctx.destination);

      await this._buildSoundLibrary();
      console.log('[AudioEngine] Initialized ✓');
    } catch(e) {
      console.warn('[AudioEngine] Web Audio not available:', e.message);
    }
  }

  // ─── SOUND LIBRARY ────────────────────────────────────────────────────────

  async _buildSoundLibrary() {
    // Synthesize all sounds procedurally (no audio files required)
    this._sounds = {
      // Engine profiles are generated live by oscillators
      // SFX are synthesized buffers

      tire_squeal:    this._synthTireSqueal(),
      tire_blowout:   this._synthBlowout(),
      turbo_flutter:  this._synthTurboFlutter(),
      antilag_pop:    this._synthAntilagPop(),
      gear_whine:     this._synthGearWhine(),
      wind_rush:      this._synthWindRush(),
      police_radio:   this._synthRadioCrackle(),
      countdown_beep: this._synthBeep(880, 0.15),
      race_start:     this._synthBeep(1320, 0.4),
      race_finish:    this._synthFinishJingle(),
      engine_off:     null, // handled by ramp-down
      collision:      this._synthCollision(),
      nitrous_hiss:   this._synthNitrousHiss(),
    };
  }

  // ─── ENGINE LOOP ─────────────────────────────────────────────────────────

  startEngineLoop(soundProfile) {
    if (!this._ctx) return;
    this._stopEngineLoop();

    const profile = ENGINE_PROFILES[soundProfile] || ENGINE_PROFILES['default'];
    this._currentSound = soundProfile;

    // Oscillator bank simulating engine harmonics
    this._engineNodes = [];

    for (const harmonic of profile.harmonics) {
      const osc  = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      const filter = this._ctx.createBiquadFilter();

      osc.type          = harmonic.type || 'sawtooth';
      osc.frequency.value = this._rpmToFreq(1000, harmonic.multiplier);
      gain.gain.value   = harmonic.gain;
      filter.type       = 'lowpass';
      filter.frequency.value = harmonic.filterHz || 800;
      filter.Q.value    = harmonic.Q || 1.5;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this._masterGain);
      osc.start();

      this._engineNodes.push({ osc, gain, filter, ...harmonic });
    }

    // Exhaust rumble (low-freq noise)
    const noiseSource = this._createNoise('brown');
    const noiseGain   = this._ctx.createGain();
    const noiseFilter = this._ctx.createBiquadFilter();
    noiseGain.gain.value     = profile.exhaustNoise || 0.06;
    noiseFilter.type         = 'bandpass';
    noiseFilter.frequency.value = 80;
    noiseFilter.Q.value      = 2;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this._masterGain);
    this._exhaustNode = { source: noiseSource, gain: noiseGain };
  }

  updateEngineRPM(rpm, throttle = 1.0) {
    if (!this._ctx || !this._engineNodes) return;
    this._targetRPM = rpm;
    this._currentRPM += (rpm - this._currentRPM) * 0.08;

    const profile = ENGINE_PROFILES[this._currentSound] || ENGINE_PROFILES['default'];

    for (const node of this._engineNodes) {
      const freq = this._rpmToFreq(this._currentRPM, node.multiplier);
      node.osc.frequency.setTargetAtTime(freq, this._ctx.currentTime, 0.05);

      // Volume tracks throttle and RPM position
      const rpmNorm    = Math.min(this._currentRPM / (profile.maxRPM || 8000), 1.0);
      const targetGain = node.gain * (0.4 + throttle * 0.6) * (0.7 + rpmNorm * 0.3);
      node.gain.gain.setTargetAtTime(targetGain, this._ctx.currentTime, 0.05);
    }
  }

  _stopEngineLoop() {
    if (this._engineNodes) {
      for (const n of this._engineNodes) { try { n.osc.stop(); } catch(e){} }
      this._engineNodes = null;
    }
    if (this._exhaustNode) {
      try { this._exhaustNode.source.stop(); } catch(e){}
      this._exhaustNode = null;
    }
  }

  stopEngineLoop() { this._stopEngineLoop(); }

  // ─── EFFECT PLAYBACK ──────────────────────────────────────────────────────

  playEffect(name) {
    if (!this._ctx || this._muted) return;
    const buf = this._sounds[name];
    if (!buf) return;
    const src  = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    src.buffer = buf;
    gain.gain.value = EFFECT_VOLUMES[name] || 0.7;
    src.connect(gain);
    gain.connect(this._masterGain);
    src.start();
  }

  playAntilag() {
    if (!this._ctx) return;
    // Multiple rapid pops
    for (let i = 0; i < 3 + Math.floor(Math.random()*3); i++) {
      setTimeout(() => this.playEffect('antilag_pop'), i * 80 + Math.random()*40);
    }
  }

  playTurboFlutter() { this.playEffect('turbo_flutter'); }
  playGearChange()   { /* handled by RPM spike */ }

  playWindRush(speedKmh) {
    if (!this._ctx) return;
    if (speedKmh < 180) return;
    // Volume scales with speed above 180
    const vol = Math.min(0.6, (speedKmh - 180) / 150);
    const src = this._ctx.createBufferSource();
    src.buffer = this._sounds.wind_rush;
    const gain = this._ctx.createGain();
    gain.gain.value = vol;
    src.connect(gain);
    gain.connect(this._masterGain);
    src.start();
  }

  // ─── SYNTHESIS ───────────────────────────────────────────────────────────

  _createNoise(type = 'white') {
    const len    = this._ctx.sampleRate * 2;
    const buf    = this._ctx.createBuffer(1, len, this._ctx.sampleRate);
    const data   = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < len; i++) {
      const white = Math.random()*2-1;
      if (type === 'brown') {
        data[i] = (b0 = (b0 + 0.02*white) / 1.02) * 3.5;
      } else if (type === 'pink') {
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980;
        data[i]=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)/7; b6=white*0.115926;
      } else {
        data[i] = white;
      }
    }
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    src.start();
    return src;
  }

  _synthTireSqueal() {
    const rate = this._ctx.sampleRate, len = rate * 0.5;
    const buf  = this._ctx.createBuffer(1, len, rate);
    const d    = buf.getChannelData(0);
    for (let i=0;i<len;i++) {
      const t = i/rate;
      d[i] = Math.sin(2*Math.PI*3200*t + Math.sin(2*Math.PI*80*t)*2) * Math.exp(-t*2) * 0.5;
      d[i] += (Math.random()-0.5) * 0.1 * Math.exp(-t*3);
    }
    return buf;
  }

  _synthBlowout() {
    const rate=this._ctx.sampleRate, len=rate*1.2;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      d[i]=(Math.random()-0.5)*Math.exp(-t*1.5)*0.8 + Math.sin(2*Math.PI*120*t)*Math.exp(-t*3)*0.4;
    }
    return buf;
  }

  _synthTurboFlutter() {
    const rate=this._ctx.sampleRate, len=rate*0.35;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      const flutter=Math.sin(2*Math.PI*35*t)*Math.exp(-t*6);
      const hiss=(Math.random()-0.5)*0.15*Math.exp(-t*4);
      d[i]=(flutter+hiss)*0.7;
    }
    return buf;
  }

  _synthAntilagPop() {
    const rate=this._ctx.sampleRate, len=rate*0.12;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      d[i]=Math.sin(2*Math.PI*140*t)*Math.exp(-t*25)*0.9 + (Math.random()-0.5)*Math.exp(-t*30)*0.5;
    }
    return buf;
  }

  _synthGearWhine() {
    const rate=this._ctx.sampleRate, len=rate*0.8;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      d[i]=Math.sin(2*Math.PI*2200*t)*0.1 + Math.sin(2*Math.PI*4400*t)*0.05;
    }
    return buf;
  }

  _synthWindRush() {
    const rate=this._ctx.sampleRate, len=rate*2;
    const buf=this._ctx.createBuffer(2,len,rate);
    for(let ch=0;ch<2;ch++){
      const d=buf.getChannelData(ch);
      let b=0;
      for(let i=0;i<len;i++){
        b=(b+0.01*(Math.random()*2-1))/1.01;
        d[i]=b*4*(ch===0?1:-1)*0.08;
      }
    }
    return buf;
  }

  _synthRadioCrackle() {
    const rate=this._ctx.sampleRate, len=rate*0.3;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      d[i]=(Math.random()-0.5)*0.3*Math.exp(-t*5) + Math.sin(2*Math.PI*1200*t)*0.05*Math.exp(-t*8);
    }
    return buf;
  }

  _synthBeep(freq, duration) {
    const rate=this._ctx.sampleRate, len=Math.floor(rate*duration);
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      const env=Math.min(t/0.005, 1)*Math.exp(-t*3);
      d[i]=Math.sin(2*Math.PI*freq*t)*env*0.6;
    }
    return buf;
  }

  _synthFinishJingle() {
    const rate=this._ctx.sampleRate, len=rate*1.2;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    const notes=[523,659,784,1047];
    for(let i=0;i<len;i++){
      const t=i/rate;
      const noteIdx=Math.floor(t/0.25)%notes.length;
      const noteT=t-(Math.floor(t/0.25)*0.25);
      const env=Math.exp(-noteT*8)*0.5;
      d[i]=Math.sin(2*Math.PI*notes[noteIdx]*t)*env;
    }
    return buf;
  }

  _synthCollision() {
    const rate=this._ctx.sampleRate, len=rate*0.4;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const t=i/rate;
      d[i]=(Math.random()-0.5)*Math.exp(-t*8)*0.9 + Math.sin(2*Math.PI*80*t)*Math.exp(-t*12)*0.5;
    }
    return buf;
  }

  _synthNitrousHiss() {
    const rate=this._ctx.sampleRate, len=rate*0.8;
    const buf=this._ctx.createBuffer(1,len,rate);
    const d=buf.getChannelData(0);
    let b=0;
    for(let i=0;i<len;i++){
      const t=i/rate;
      b=(b+0.05*(Math.random()*2-1))/1.05;
      d[i]=b*2*(1-t/0.8)*0.3;
    }
    return buf;
  }

  _rpmToFreq(rpm, multiplier = 1) {
    return (rpm / 60) * multiplier * 2;
  }

  setMuted(val) {
    this._muted = val;
    if (this._masterGain) this._masterGain.gain.value = val ? 0 : 0.85;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE SOUND PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

const ENGINE_PROFILES = {
  default: {
    maxRPM: 7000, exhaustNoise: 0.05,
    harmonics: [
      { multiplier:0.5, type:'sawtooth', gain:0.18, filterHz:400, Q:1.2 },
      { multiplier:1.0, type:'sawtooth', gain:0.22, filterHz:600, Q:1.5 },
      { multiplier:2.0, type:'square',   gain:0.10, filterHz:800, Q:1.8 },
    ],
  },
  rb26_inline6: {
    maxRPM: 8200, exhaustNoise: 0.08,
    harmonics: [
      { multiplier:3, type:'sawtooth', gain:0.20, filterHz:500, Q:1.5 },
      { multiplier:6, type:'sawtooth', gain:0.15, filterHz:700, Q:1.8 },
      { multiplier:9, type:'square',   gain:0.08, filterHz:900, Q:2.0 },
    ],
  },
  '2jz_inline6': {
    maxRPM: 7000, exhaustNoise: 0.07,
    harmonics: [
      { multiplier:3, type:'sawtooth', gain:0.22, filterHz:450, Q:1.4 },
      { multiplier:6, type:'sawtooth', gain:0.14, filterHz:650, Q:1.6 },
      { multiplier:12,type:'sine',     gain:0.06, filterHz:900, Q:1.2 },
    ],
  },
  '5cyl_turbo': {
    maxRPM: 8200, exhaustNoise: 0.12,  // rougher, louder Group B
    harmonics: [
      { multiplier:2.5,type:'sawtooth', gain:0.24, filterHz:600, Q:2.0 },
      { multiplier:5,  type:'square',   gain:0.16, filterHz:900, Q:2.5 },
      { multiplier:7.5,type:'sawtooth', gain:0.10, filterHz:1200,Q:3.0 },
    ],
  },
  '13b_rotary': {
    maxRPM: 9000, exhaustNoise: 0.04,  // smooth but high-pitched
    harmonics: [
      { multiplier:2, type:'sine',     gain:0.20, filterHz:800, Q:0.8 },
      { multiplier:4, type:'sine',     gain:0.18, filterHz:1200,Q:1.0 },
      { multiplier:6, type:'triangle', gain:0.12, filterHz:1800,Q:1.2 },
    ],
  },
  '4age_na': {
    maxRPM: 7800, exhaustNoise: 0.04,
    harmonics: [
      { multiplier:2, type:'sawtooth', gain:0.18, filterHz:500, Q:1.2 },
      { multiplier:4, type:'square',   gain:0.12, filterHz:750, Q:1.5 },
    ],
  },
  busso_v6: {
    maxRPM: 9000, exhaustNoise: 0.06,
    harmonics: [
      { multiplier:3, type:'sawtooth', gain:0.20, filterHz:600, Q:1.4 },
      { multiplier:6, type:'sawtooth', gain:0.16, filterHz:900, Q:1.8 },
      { multiplier:9, type:'sine',     gain:0.08, filterHz:1400,Q:1.0 },
    ],
  },
};

const EFFECT_VOLUMES = {
  tire_squeal:   0.55,
  tire_blowout:  0.80,
  turbo_flutter: 0.60,
  antilag_pop:   0.75,
  gear_whine:    0.25,
  wind_rush:     0.40,
  police_radio:  0.50,
  countdown_beep:0.65,
  race_start:    0.80,
  race_finish:   0.70,
  collision:     0.85,
  nitrous_hiss:  0.50,
};

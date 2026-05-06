import { VNRenderer }         from './engine/rendering/Renderer.js';
import { CarModelEngine }     from './engine/rendering/CarModelEngine.js';
import { Physics }            from './engine/physics/Physics.js';
import { InputManager }       from './engine/core/InputManager.js';
import { AudioEngine }        from './engine/audio/AudioEngine.js';
import { AIDriver }           from './engine/ai/AIDriver.js';
import { HeatSystem }         from './game/HeatSystem.js';
import { StakeSystem }        from './game/StakeSystem.js';
import { CarDatabase }        from './game/CarDatabase.js';
import { TrackBuilder }       from './game/TrackBuilder.js';
import { RaceManager }        from './game/RaceManager.js';
import { ProgressionManager } from './game/ProgressionManager.js';
import { GarageManager }      from './game/GarageManager.js';
import { UIManager }          from './ui/UIManager.js';
import { Tutorial }           from './ui/Tutorial.js';

class VelocityNoir {
  constructor() {
    this.canvas      = document.getElementById('game-canvas');
    this.uiLayer     = document.getElementById('ui-layer');
    this.isRunning   = false;
    this.lastTime    = 0;
    this.deltaTime   = 0;
    this.fixedStep   = 1 / 60;
    this.accumulator = 0;
    this.renderer    = null;
    this.carEngine   = null;
    this.physics     = null;
    this.input       = null;
    this.audio       = null;
    this.ai          = null;
    this.heatSystem  = null;
    this.stakeSystem = null;
    this.carDB       = null;
    this.trackBuilder= null;
    this.raceManager = null;
    this.progression = null;
    this.garage      = null;
    this.ui          = null;
    this.tutorial    = null;
    this._systemStatus = {};
  }

  async _try(name, fn) {
    this._setLoadingText(name + '...');
    try {
      await fn();
      this._systemStatus[name] = 'ok';
      console.log('[VN] OK: ' + name);
    } catch(e) {
      this._systemStatus[name] = 'FAILED: ' + e.message;
      console.warn('[VN] FAIL: ' + name + ' - ' + e.message);
    }
  }

  async init() {
    this._setLoadingProgress(2);
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    await this._try('WebGL Renderer', async () => {
      this.renderer = new VNRenderer(this.canvas);
      await this.renderer.init();
    });
    this._setLoadingProgress(14);

    await this._try('Car Model Engine', async () => {
      if (!this.renderer) throw new Error('No renderer');
      this.carEngine = new CarModelEngine(this.renderer);
      await this.carEngine.init();
    });
    this._setLoadingProgress(26);

    await this._try('Shader Compilation', async () => {
      if (!this.renderer) throw new Error('No renderer');
      await this.renderer.compileAllShaders();
    });
    this._setLoadingProgress(38);

    await this._try('Physics', async () => {
      this.physics = new Physics();
    });
    this._setLoadingProgress(46);

    await this._try('Input Manager', async () => {
      this.input = new InputManager(this.canvas);
      this.input.init();
    });
    this._setLoadingProgress(52);

    await this._try('Audio Engine', async () => {
      this.audio = new AudioEngine();
      await this.audio.init();
    });
    this._setLoadingProgress(60);

    await this._try('AI Driver', async () => {
      this.ai = new AIDriver();
    });
    this._setLoadingProgress(65);

    await this._try('Car Database', async () => {
      this.carDB = new CarDatabase();
      await this.carDB.load();
    });
    this._setLoadingProgress(72);

    await this._try('Track Builder', async () => {
      this.trackBuilder = new TrackBuilder(this.renderer);
      await this.trackBuilder.init();
    });
    this._setLoadingProgress(79);

    await this._try('Game Systems', async () => {
      this.heatSystem  = new HeatSystem(this.audio, this.ai);
      this.stakeSystem = new StakeSystem();
      this.progression = new ProgressionManager();
      this.garage      = new GarageManager(this.carDB, this.stakeSystem);
      this.raceManager = new RaceManager({
        renderer:     this.renderer,
        carEngine:    this.carEngine,
        physics:      this.physics,
        input:        this.input,
        audio:        this.audio,
        ai:           this.ai,
        heatSystem:   this.heatSystem,
        stakeSystem:  this.stakeSystem,
        trackBuilder: this.trackBuilder,
        garage:       this.garage,
        carDB:        this.carDB,
      });
      await this.raceManager.init();
    });
    this._setLoadingProgress(88);

    await this._try('UI Manager', async () => {
      this.ui = new UIManager(this.uiLayer, {
        raceManager: this.raceManager,
        progression: this.progression,
        garage:      this.garage,
        carDB:       this.carDB,
        audio:       this.audio,
        input:       this.input,
      });
      this.ui.init();
    });
    this._setLoadingProgress(95);

    await this._try('Tutorial', async () => {
      this.tutorial = new Tutorial(this.ui, this.input);
    });
    this._setLoadingProgress(100);

    await this._sleep(400);
    this._hideLoadingScreen();

    console.log('[VN] Status:', JSON.stringify(this._systemStatus));

    if (!this.ui) {
      document.body.innerHTML += '<div style="position:fixed;inset:0;background:#000;color:#ff4400;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:1rem;text-align:center;padding:20px;z-index:9999;">UI FAILED TO LOAD<br>Check console</div>';
      return;
    }

    const isFirstRun = !localStorage.getItem('vn_tutorial_done');
    if (isFirstRun && this.tutorial) {
      this.tutorial.start(() => {
        localStorage.setItem('vn_tutorial_done', '1');
        this.ui.showMainMenu();
      });
    } else {
      this.ui.showMainMenu();
    }

    this.isRunning = true;
    this.lastTime  = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _loop(timestamp) {
    if (!this.isRunning) return;
    this.deltaTime   = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime    = timestamp;
    this.accumulator += this.deltaTime;
    while (this.accumulator >= this.fixedStep) {
      this.physics?.step(this.fixedStep);
      this.heatSystem?.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }
    const alpha = this.accumulator / this.fixedStep;
    try { this.raceManager?.update(this.deltaTime); } catch(e) {}
    try { this.ai?.update(this.deltaTime);           } catch(e) {}
    try { this.renderer?.render(alpha);              } catch(e) {}
    try { this.ui?.update(this.deltaTime);           } catch(e) {}
    requestAnimationFrame((t) => this._loop(t));
  }

  _resizeCanvas() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width        = window.innerWidth  * dpr;
    this.canvas.height       = window.innerHeight * dpr;
    this.canvas.style.width  = window.innerWidth  + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.renderer?.onResize?.(this.canvas.width, this.canvas.height);
  }

  _setLoadingText(text) {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
  }

  _setLoadingProgress(p) {
    const el = document.getElementById('loading-bar');
    if (el) el.style.width = p + '%';
  }

  _hideLoadingScreen() {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 550);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  window.VN = new VelocityNoir();
  try {
    await window.VN.init();
  } catch(err) {
    console.error('[VelocityNoir] Fatal:', err);
    const el = document.getElementById('loading-text');
    if (el) { el.textContent = 'ERROR: ' + err.message; el.style.color = '#ff0000'; }
  }
});

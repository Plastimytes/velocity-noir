/**
 * VELOCITY NOIR — Main Bootstrap
 * Initializes all engine systems and starts the game loop.
 */

import { VNRenderer }       from './engine/rendering/Renderer.js';
import { CarModelEngine }   from './engine/rendering/CarModelEngine.js';
import { Physics }          from './engine/physics/Physics.js';
import { InputManager }     from './engine/core/InputManager.js';
import { AudioEngine }      from './engine/audio/AudioEngine.js';
import { AIDriver }         from './engine/ai/AIDriver.js';
import { HeatSystem }       from './game/HeatSystem.js';
import { StakeSystem }      from './game/StakeSystem.js';
import { CarDatabase }      from './game/CarDatabase.js';
import { TrackBuilder }     from './game/TrackBuilder.js';
import { RaceManager }      from './game/RaceManager.js';
import { ProgressionManager } from './game/ProgressionManager.js';
import { GarageManager }    from './game/GarageManager.js';
import { UIManager }        from './ui/UIManager.js';
import { Tutorial }         from './ui/Tutorial.js';

class VelocityNoir {
  constructor() {
    this.canvas    = document.getElementById('game-canvas');
    this.uiLayer   = document.getElementById('ui-layer');
    this.isRunning = false;
    this.lastTime  = 0;
    this.deltaTime = 0;
    this.fixedStep = 1 / 60; // 60 fps physics
    this.accumulator = 0;

    // Engine systems
    this.renderer   = null;
    this.carEngine  = null;
    this.physics    = null;
    this.input      = null;
    this.audio      = null;
    this.ai         = null;

    // Game systems
    this.heatSystem       = null;
    this.stakeSystem      = null;
    this.carDB            = null;
    this.trackBuilder     = null;
    this.raceManager      = null;
    this.progression      = null;
    this.garage           = null;
    this.ui               = null;
    this.tutorial         = null;
  }

  async init() {
    this._setLoadingText('Booting VN Engine...');
    this._setLoadingProgress(5);

    // Resize canvas to device pixel ratio
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());

    // ─── ENGINE LAYER ───────────────────────────────────────────────────────
    this._setLoadingText('Loading WebGL renderer...');
    this.renderer = new VNRenderer(this.canvas);
    await this.renderer.init();
    this._setLoadingProgress(15);

    this._setLoadingText('Building car model engine...');
    this.carEngine = new CarModelEngine(this.renderer);
    await this.carEngine.init();
    this._setLoadingProgress(28);

    this._setLoadingText('Compiling shaders...');
    await this.renderer.compileAllShaders();
    this._setLoadingProgress(40);

    this._setLoadingText('Initializing physics...');
    this.physics = new Physics();
    this._setLoadingProgress(50);

    this._setLoadingText('Binding input...');
    this.input = new InputManager(this.canvas);
    this.input.init();
    this._setLoadingProgress(55);

    this._setLoadingText('Loading audio engine...');
    this.audio = new AudioEngine();
    await this.audio.init();
    this._setLoadingProgress(63);

    this._setLoadingText('Building AI drivers...');
    this.ai = new AIDriver();
    this._setLoadingProgress(68);

    // ─── GAME LAYER ─────────────────────────────────────────────────────────
    this._setLoadingText('Loading car database...');
    this.carDB = new CarDatabase();
    await this.carDB.load();
    this._setLoadingProgress(72);

    this._setLoadingText('Generating tracks...');
    this.trackBuilder = new TrackBuilder(this.renderer);
    await this.trackBuilder.init();
    this._setLoadingProgress(80);

    this._setLoadingText('Initializing systems...');
    this.heatSystem   = new HeatSystem(this.audio, this.ai);
    this.stakeSystem  = new StakeSystem();
    this.progression  = new ProgressionManager();
    this.garage       = new GarageManager(this.carDB, this.stakeSystem);
    this.raceManager  = new RaceManager({
      renderer:    this.renderer,
      carEngine:   this.carEngine,
      physics:     this.physics,
      input:       this.input,
      audio:       this.audio,
      ai:          this.ai,
      heatSystem:  this.heatSystem,
      stakeSystem: this.stakeSystem,
      trackBuilder:this.trackBuilder,
      garage:      this.garage,
    });
    this._setLoadingProgress(88);

    // ─── UI LAYER ────────────────────────────────────────────────────────────
    this._setLoadingText('Building UI...');
    this.ui = new UIManager(this.uiLayer, {
      raceManager: this.raceManager,
      progression: this.progression,
      garage:      this.garage,
      carDB:       this.carDB,
      audio:       this.audio,
      input:       this.input,
    });
    this.ui.init();
    this._setLoadingProgress(95);

    this._setLoadingText('Preparing tutorial...');
    this.tutorial = new Tutorial(this.ui, this.input);
    this._setLoadingProgress(100);

    // ─── LAUNCH ─────────────────────────────────────────────────────────────
    await this._sleep(600); // brief pause for loading screen
    this._hideLoadingScreen();

    // First-run tutorial check
    const isFirstRun = !localStorage.getItem('vn_tutorial_done');
    if (isFirstRun) {
      this.tutorial.start(() => {
        localStorage.setItem('vn_tutorial_done', '1');
        this.ui.showMainMenu();
      });
    } else {
      this.ui.showMainMenu();
    }

    // Start the main loop
    this.isRunning = true;
    requestAnimationFrame((t) => this._loop(t));
  }

  // ─── MAIN GAME LOOP ────────────────────────────────────────────────────────
  _loop(timestamp) {
    if (!this.isRunning) return;

    this.deltaTime   = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime    = timestamp;
    this.accumulator += this.deltaTime;

    // Fixed-step physics
    while (this.accumulator >= this.fixedStep) {
      this.physics.step(this.fixedStep);
      this.heatSystem.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    // Variable render step
    const alpha = this.accumulator / this.fixedStep;
    this.raceManager.update(this.deltaTime);
    this.ai.update(this.deltaTime);
    this.renderer.render(alpha);
    this.ui.update(this.deltaTime);

    requestAnimationFrame((t) => this._loop(t));
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  _resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x for perf
    this.canvas.width  = window.innerWidth  * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width  = window.innerWidth  + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    if (this.renderer) this.renderer.onResize(this.canvas.width, this.canvas.height);
  }

  _setLoadingText(text)  { const el = document.getElementById('loading-text'); if (el) el.textContent = text; }
  _setLoadingProgress(p) { const el = document.getElementById('loading-bar');  if (el) el.style.width = p + '%'; }
  _hideLoadingScreen()   { const el = document.getElementById('loading-screen'); if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; setTimeout(() => el.remove(), 500); } }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  window.VN = new VelocityNoir();
  try {
    await window.VN.init();
  } catch (err) {
    console.error('[VelocityNoir] Fatal init error:', err);
    document.getElementById('loading-text').textContent = 'ERROR: ' + err.message;
    document.getElementById('loading-text').style.color = '#ff0000';
  }
});

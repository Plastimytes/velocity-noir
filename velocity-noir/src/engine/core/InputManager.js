/**
 * InputManager — Mobile Controls
 * Supports two layouts:
 *   Mode A: "Tilt" — Device gyroscope steering, tap left=gas, tap right=brake, double-tap=nitrous
 *   Mode B: "Buttons" — 4 arrow-key style buttons + nitrous + handbrake
 * Hot-swappable mid-session from the pause menu.
 */

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;

    // ── State ─────────────────────────────────────────────────────────────
    this.throttle   = 0;
    this.brake      = 0;
    this.steer      = 0;
    this.nitrous    = false;
    this.handbrake  = false;
    this.pause      = false;

    this.mode       = localStorage.getItem('vn_control_mode') || 'tilt';

    // ── Tilt ──────────────────────────────────────────────────────────────
    this._tiltCenter   = 0;
    this._tiltRaw      = 0;
    this._tiltCalibrated = false;

    // ── Touch zones ───────────────────────────────────────────────────────
    this._touches       = new Map();
    this._leftPressed   = false;
    this._rightPressed  = false;
    this._upPressed     = false;
    this._downPressed   = false;
    this._nitrousPressed= false;

    // ── Double tap detection ──────────────────────────────────────────────
    this._lastTapTime   = 0;
    this._lastTapSide   = '';

    // ── Button UI root ────────────────────────────────────────────────────
    this._btnRoot    = null;
  }

  init() {
    this._buildButtonUI();
    this._bindTilt();
    this._bindTouch();
    this._bindKeyboard(); // desktop fallback
    this._setMode(this.mode);
    console.log(`[InputManager] Initialized in ${this.mode} mode ✓`);
  }

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('vn_control_mode', mode);
    this._setMode(mode);
  }

  _setMode(mode) {
    if (!this._btnRoot) return;
    const tiltHint = document.getElementById('vn-tilt-hint');
    if (mode === 'tilt') {
      this._btnRoot.style.display = 'none';
      if (tiltHint) tiltHint.style.display = 'flex';
      this._calibrateTilt();
    } else {
      this._btnRoot.style.display = 'flex';
      if (tiltHint) tiltHint.style.display = 'none';
    }
  }

  // ─── TILT ────────────────────────────────────────────────────────────────

  _bindTilt() {
    if (!window.DeviceMotionEvent && !window.DeviceOrientationEvent) return;

    // Request permission (iOS 13+)
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      document.addEventListener('touchend', () => {
        DeviceOrientationEvent.requestPermission()
          .then(state => { if (state === 'granted') this._listenOrientation(); })
          .catch(()=>{});
      }, { once: true });
    } else {
      this._listenOrientation();
    }
  }

  _listenOrientation() {
    window.addEventListener('deviceorientation', (e) => {
      // gamma = left/right tilt (-90 to 90)
      this._tiltRaw = e.gamma || 0;
      if (!this._tiltCalibrated) { this._tiltCenter = this._tiltRaw; this._tiltCalibrated = true; }
    });
  }

  _calibrateTilt() {
    this._tiltCalibrated = false;
    setTimeout(() => { this._tiltCalibrated = false; }, 500);
  }

  // ─── TOUCH ───────────────────────────────────────────────────────────────

  _bindTouch() {
    const c = document.body;

    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) this._onTouchStart(t);
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) this._onTouchMove(t);
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) this._onTouchEnd(t);
    }, { passive: false });
  }

  _onTouchStart(t) {
    const x = t.clientX, y = t.clientY;
    const W = window.innerWidth, H = window.innerHeight;
    this._touches.set(t.identifier, { x, y, startX: x, startY: y });

    if (this.mode === 'tilt') {
      const side = x < W * 0.5 ? 'left' : 'right';
      // Double-tap detection for nitrous
      const now = Date.now();
      if (side === this._lastTapSide && now - this._lastTapTime < 280) {
        this.nitrous = true;
        setTimeout(() => this.nitrous = false, 800);
      }
      this._lastTapTime = now;
      this._lastTapSide = side;

      if (side === 'left')  this._leftPressed  = true;   // throttle
      if (side === 'right') this._rightPressed = true;   // brake
    }
  }

  _onTouchMove(t) {
    const touch = this._touches.get(t.identifier);
    if (touch) { touch.x = t.clientX; touch.y = t.clientY; }
  }

  _onTouchEnd(t) {
    const touch = this._touches.get(t.identifier);
    if (!touch) return;
    const W = window.innerWidth;
    if (this.mode === 'tilt') {
      if (touch.startX < W * 0.5) this._leftPressed  = false;
      else                         this._rightPressed = false;
    }
    this._touches.delete(t.identifier);
  }

  // ─── BUTTON UI ───────────────────────────────────────────────────────────

  _buildButtonUI() {
    const root = document.createElement('div');
    root.id = 'vn-controls';
    root.innerHTML = `
      <style>
        #vn-controls {
          position: fixed; bottom: 0; left: 0; right: 0;
          height: 38vh;
          display: flex; align-items: flex-end; justify-content: space-between;
          padding: 0 20px 30px;
          pointer-events: auto;
          z-index: 100;
          display: none;
        }
        .vn-btn-group { display: flex; flex-direction: column; gap: 8px; }
        .vn-btn-row   { display: flex; gap: 8px; }
        .vn-btn {
          width: 72px; height: 72px;
          background: rgba(255,255,255,0.08);
          border: 1.5px solid rgba(255,255,255,0.20);
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px;
          color: rgba(255,255,255,0.7);
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.05s;
          touch-action: none;
        }
        .vn-btn.pressed {
          background: rgba(255,100,0,0.35);
          border-color: rgba(255,100,0,0.7);
          color: #fff;
        }
        .vn-btn-nitrous {
          width: 80px; height: 80px;
          background: rgba(255,50,0,0.12);
          border: 1.5px solid rgba(255,80,0,0.4);
          border-radius: 50%;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          color: #ff6600;
          text-transform: uppercase;
        }
        .vn-btn-nitrous.pressed { background: rgba(255,80,0,0.5); color: #fff; }
        #vn-tilt-hint {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          display: flex; gap: 40px;
          pointer-events: none; z-index: 100;
        }
        .vn-tilt-zone {
          padding: 8px 20px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.35);
          font-size: 10px; letter-spacing: 0.15em;
          font-family: 'Courier New', monospace;
          text-transform: uppercase;
        }
      </style>

      <!-- Left side: D-pad (steer left/right + brake) -->
      <div class="vn-btn-group">
        <div class="vn-btn-row" style="justify-content:center">
          <div class="vn-btn" id="btn-up">▲</div>
        </div>
        <div class="vn-btn-row">
          <div class="vn-btn" id="btn-left">◀</div>
          <div class="vn-btn" id="btn-down">▼</div>
          <div class="vn-btn" id="btn-right">▶</div>
        </div>
      </div>

      <!-- Right side: Throttle + Nitrous + Handbrake -->
      <div class="vn-btn-group" style="align-items:flex-end">
        <div class="vn-btn-row">
          <div class="vn-btn vn-btn-nitrous" id="btn-nitrous">N²O</div>
        </div>
        <div class="vn-btn-row">
          <div class="vn-btn" id="btn-handbrake" style="font-size:11px;letter-spacing:0.05em">HAND<br>BRAKE</div>
          <div class="vn-btn" id="btn-throttle" style="font-size:26px">●</div>
        </div>
      </div>
    `;

    // Tilt hint
    const hint = document.createElement('div');
    hint.id = 'vn-tilt-hint';
    hint.innerHTML = `
      <div class="vn-tilt-zone">← Tap: Gas</div>
      <div class="vn-tilt-zone">Double-tap: N²O</div>
      <div class="vn-tilt-zone">Tap →: Brake</div>
    `;

    document.body.appendChild(root);
    document.body.appendChild(hint);
    this._btnRoot = root;

    // Wire up buttons
    this._wireBtn('btn-up',        () => this._upPressed=true,      () => this._upPressed=false);
    this._wireBtn('btn-down',      () => this._downPressed=true,    () => this._downPressed=false);
    this._wireBtn('btn-left',      () => this._leftPressed=true,    () => this._leftPressed=false);
    this._wireBtn('btn-right',     () => this._rightPressed=true,   () => this._rightPressed=false);
    this._wireBtn('btn-throttle',  () => this._upPressed=true,      () => this._upPressed=false);
    this._wireBtn('btn-nitrous',   () => this._nitrousPressed=true, () => this._nitrousPressed=false);
    this._wireBtn('btn-handbrake', () => this.handbrake=true,       () => this.handbrake=false);
  }

  _wireBtn(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = () => { onDown(); el.classList.add('pressed'); };
    const up   = () => { onUp();   el.classList.remove('pressed'); };
    el.addEventListener('touchstart', (e) => { e.stopPropagation(); down(); }, { passive: true });
    el.addEventListener('touchend',   (e) => { e.stopPropagation(); up();   }, { passive: true });
    el.addEventListener('mousedown',  down);
    el.addEventListener('mouseup',    up);
  }

  // ─── KEYBOARD (desktop dev) ───────────────────────────────────────────────

  _bindKeyboard() {
    const keys = new Set();
    window.addEventListener('keydown', e => {
      keys.add(e.code);
      if (e.code === 'KeyP') this.pause = !this.pause;
    });
    window.addEventListener('keyup', e => keys.delete(e.code));

    // Poll keys in update
    this._keys = keys;
  }

  // ─── POLL (called every frame) ────────────────────────────────────────────

  getState() {
    if (this.mode === 'tilt') {
      return this._getTiltState();
    } else {
      return this._getButtonState();
    }
  }

  _getTiltState() {
    const tiltOffset = this._tiltRaw - this._tiltCenter;
    const steer  = Math.max(-1, Math.min(1, tiltOffset / 25.0));
    const throttle = this._leftPressed  ? 1.0 : 0.0;
    const brake    = this._rightPressed ? 1.0 : 0.0;
    return { throttle, brake, steer, nitrous: this.nitrous, handbrake: this.handbrake };
  }

  _getButtonState() {
    const k = this._keys || new Set();
    const left  = this._leftPressed  || k.has('ArrowLeft')  || k.has('KeyA');
    const right = this._rightPressed || k.has('ArrowRight') || k.has('KeyD');
    const up    = this._upPressed    || k.has('ArrowUp')    || k.has('KeyW');
    const down  = this._downPressed  || k.has('ArrowDown')  || k.has('KeyS');
    const nos   = this._nitrousPressed || k.has('ShiftLeft') || k.has('Space');

    const steer    = (right ? 1 : 0) - (left ? 1 : 0);
    const throttle = up   ? 1.0 : 0.0;
    const brake    = down ? 1.0 : 0.0;

    return { throttle, brake, steer, nitrous: nos, handbrake: this.handbrake };
  }
}

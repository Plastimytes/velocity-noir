/**
 * UIManager — All UI screens and HUD
 * Screens: MainMenu | StageSelect | Garage | Race HUD | Results | Tutorial
 */

export class UIManager {
  constructor(root, systems) {
    this.root    = root;
    this.systems = systems;
    this.hud     = new HUD(root);
    this._current= null;
  }

  init() {
    this._injectStyles();
    this.hud.build();
  }

  update(dt) {
    if (this.hud) this.hud.tick(dt);
  }

  // ─── SCREEN ROUTING ───────────────────────────────────────────────────────

  showMainMenu()            { this._show('main_menu');    this._buildMainMenu(); }
  showStageSelect()         { this._show('stage_select'); this._buildStageSelect(); }
  showGarage()              { this._show('garage');       this._buildGarage(); }
  showResults(data)         { this._show('results');      this._buildResults(data); }
  showImpoundScreen(data)   { this._show('impound');      this._buildImpound(data); }
  showPinkSlipScreen(data)  { this._show('pinkslip');     this._buildPinkSlip(data); }

  _show(name) {
    this._current = name;
    this.root.innerHTML = '';
    this.hud.hide();
  }

  showHUD() { this.hud.show(); }

  // ─── MAIN MENU ───────────────────────────────────────────────────────────

  _buildMainMenu() {
    const { progression, garage } = this.systems;
    const car = garage.getActiveCar();

    this.root.innerHTML = `
      <div class="vn-screen vn-main-menu">
        <div class="vn-logo-block">
          <div class="vn-logo">VELOCITY<br>NOIR</div>
          <div class="vn-logo-sub">STREET RACING · NO RULES · NO MERCY</div>
        </div>
        <div class="vn-menu-items">
          <div class="vn-menu-item" id="mm-story">STORY MODE</div>
          <div class="vn-menu-item" id="mm-arcade">ARCADE GAUNTLET</div>
          <div class="vn-menu-item" id="mm-freedrive">FREE DRIVE</div>
          <div class="vn-menu-item" id="mm-garage">GARAGE</div>
          <div class="vn-menu-item secondary" id="mm-settings">SETTINGS</div>
        </div>
        <div class="vn-active-car">
          <div class="vn-active-car-label">ACTIVE CAR</div>
          <div class="vn-active-car-name">${car?.def?.name || '—'}</div>
          <div class="vn-active-car-stats">
            <span>${car?.def?.topSpeed || 0} km/h</span>
            <span>${car?.def?.acceleration || 0}s 0-100</span>
            <span>⚡ ${car?.def?.maxTorque || 0}Nm</span>
          </div>
        </div>
        <div class="vn-cash-display">$${garage.cash.toLocaleString()}</div>
      </div>
    `;

    document.getElementById('mm-arcade')?.addEventListener('click', () => this.showStageSelect());
    document.getElementById('mm-garage')?.addEventListener('click', () => this.showGarage());
    document.getElementById('mm-story')?.addEventListener('click', () => this._startQuickRace());
    document.getElementById('mm-settings')?.addEventListener('click', () => this._buildSettings());
  }

  // ─── STAGE SELECT ────────────────────────────────────────────────────────

  _buildStageSelect() {
    const { progression } = this.systems;
    const stages = progression.getAllStages();

    const stageCards = stages.map(s => {
      const unlocked  = progression.isStageUnlocked(s.id);
      const comp      = Math.round(progression.getStageCompletion(s.id) * 100);
      const gold      = progression.isGoldMastery(s.id);
      return `
        <div class="vn-stage-card ${unlocked?'unlocked':''} ${gold?'gold':''}"
             data-stage="${s.id}" style="${!unlocked?'opacity:0.35;pointer-events:none':''}">
          <div class="vn-stage-num">${s.number.toString().padStart(2,'0')}</div>
          <div class="vn-stage-name">${s.name}</div>
          <div class="vn-stage-comp">
            <div class="vn-comp-bar"><div style="width:${comp}%"></div></div>
            <span>${comp}%</span>
            ${gold?'<span class="vn-gold-badge">★ GOLD</span>':''}
          </div>
        </div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="vn-screen vn-stage-select">
        <div class="vn-screen-header">
          <button class="vn-back-btn" id="stage-back">← BACK</button>
          <h2>ARCADE GAUNTLET</h2>
          <span class="vn-header-sub">10 STAGES · 25 EVENTS EACH</span>
        </div>
        <div class="vn-stage-grid">${stageCards}</div>
      </div>
    `;

    document.getElementById('stage-back')?.addEventListener('click', () => this.showMainMenu());
    this.root.querySelectorAll('.vn-stage-card.unlocked').forEach(card => {
      card.addEventListener('click', () => {
        const stageId = card.dataset.stage;
        this._buildEventList(stageId);
      });
    });
  }

  _buildEventList(stageId) {
    const { progression, garage } = this.systems;
    const stage = progression.getStage(stageId);
    if (!stage) return;

    const eventItems = stage.events.map(ev => {
      const status = progression.getEventStatus(stageId, ev.id);
      const stars  = '★'.repeat(status.stars) + '☆'.repeat(3-status.stars);
      const badge  = ev.isMilestone ? '🎯' : ev.isLegendary ? '👑' : '';
      return `
        <div class="vn-event-item ${status.completed?'completed':''} ${ev.isMilestone?'milestone':''}"
             data-event-id="${ev.id}" data-stage="${stageId}">
          <span class="vn-ev-num">${ev.number}</span>
          <div class="vn-ev-info">
            <div class="vn-ev-name">${badge} ${ev.name}</div>
            <div class="vn-ev-type">${ev.type.toUpperCase()} · ${ev.opponents} opponents</div>
          </div>
          <div class="vn-ev-reward">
            <div class="vn-ev-stars">${stars}</div>
            <div class="vn-ev-cash">$${ev.reward.toLocaleString()}</div>
          </div>
        </div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="vn-screen vn-event-list">
        <div class="vn-screen-header">
          <button class="vn-back-btn" id="ev-back">← STAGES</button>
          <h2>${stage.name}</h2>
          <span class="vn-header-sub">${Math.round(progression.getStageCompletion(stageId)*100)}% COMPLETE</span>
        </div>
        <div class="vn-event-scroll">${eventItems}</div>
      </div>
    `;

    document.getElementById('ev-back')?.addEventListener('click', () => this.showStageSelect());
    this.root.querySelectorAll('.vn-event-item').forEach(item => {
      item.addEventListener('click', () => {
        this._confirmRace(item.dataset.stageId || stageId, item.dataset.eventId);
      });
    });
  }

  _confirmRace(stageId, eventId) {
    const { progression, garage } = this.systems;
    const stage = progression.getStage(stageId);
    const event = stage?.events.find(e=>e.id===eventId);
    const car   = garage.getActiveCar();
    if (!event || !car) return;

    this.root.innerHTML = `
      <div class="vn-screen vn-confirm-race">
        <div class="vn-confirm-card">
          <div class="vn-confirm-title">${event.name}</div>
          <div class="vn-confirm-details">
            <div>TYPE: ${event.type.toUpperCase()}</div>
            <div>OPPONENTS: ${event.opponents}</div>
            <div>REWARD: $${event.reward.toLocaleString()}</div>
            ${event.isMilestone?`<div class="vn-milestone-req">⚡ ${event.milestoneReq?.label}</div>`:''}
          </div>
          <div class="vn-confirm-car">
            YOUR CAR: ${car.def.name}
          </div>
          <div class="vn-confirm-btns">
            <button class="vn-btn-primary" id="race-go">RACE</button>
            <button class="vn-btn-secondary" id="race-cancel">CANCEL</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('race-go')?.addEventListener('click', async () => {
      this._show('hud');
      this.hud.show();
      await window.VN?.raceManager?.startRace(event, garage.getActiveCarId());
    });
    document.getElementById('race-cancel')?.addEventListener('click', () => this._buildEventList(stageId));
  }

  _startQuickRace() {
    const { garage, progression } = this.systems;
    const stage = progression.getStage('stage_1');
    const event = stage?.events[0];
    if (!event) return;
    this._show('hud');
    this.hud.show();
    window.VN?.raceManager?.startRace(event, garage.getActiveCarId());
  }

  // ─── GARAGE ──────────────────────────────────────────────────────────────

  _buildGarage() {
    const { garage, carDB } = this.systems;
    const owned   = garage.getAllOwned();
    const cars    = carDB.getAll().filter(c => !c.locked || garage.owns(c.id));

    const ownedItems = owned.map(c => {
      const active = garage.getActiveCarId() === c.id;
      const status = window.VN?.stakeSystem?.getCarStatus(c.id) || {};
      return `
        <div class="vn-garage-car ${active?'active':''} ${status.seized?'seized':''}"
             data-car="${c.id}">
          <div class="vn-gc-name">${c.def.name}</div>
          <div class="vn-gc-stats">
            <span>${c.def.topSpeed}km/h</span>
            <span>${c.def.acceleration}s</span>
            <span class="vn-gc-class">${c.def.class.toUpperCase()}</span>
          </div>
          ${active?'<div class="vn-gc-active-badge">ACTIVE</div>':''}
          ${status.seized?`<div class="vn-gc-seized">SEIZED — BAIL: $${status.bail?.toLocaleString()}</div>`:''}
          <div class="vn-gc-strikes">${'⚠'.repeat(status.strikes||0)}</div>
        </div>`;
    }).join('');

    this.root.innerHTML = `
      <div class="vn-screen vn-garage-screen">
        <div class="vn-screen-header">
          <button class="vn-back-btn" id="garage-back">← BACK</button>
          <h2>GARAGE</h2>
          <span class="vn-cash-header">$${garage.cash.toLocaleString()}</span>
        </div>
        <div class="vn-garage-tabs">
          <button class="vn-tab active" data-tab="owned">MY CARS (${owned.length})</button>
          <button class="vn-tab" data-tab="shop">CAR SHOP</button>
        </div>
        <div class="vn-garage-content">
          <div id="tab-owned" class="vn-tab-pane active">
            <div class="vn-garage-grid">${ownedItems}</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('garage-back')?.addEventListener('click', () => this.showMainMenu());
    this.root.querySelectorAll('.vn-garage-car').forEach(el => {
      el.addEventListener('click', () => {
        garage.setActiveCar(el.dataset.car);
        this._buildGarage();
      });
    });
  }

  // ─── RESULTS ─────────────────────────────────────────────────────────────

  _buildResults(data) {
    const pos  = data.position;
    const win  = pos === 1;
    const mins = Math.floor(data.time / 60);
    const secs = (data.time % 60).toFixed(3);
    const reward = win ? data.event.reward : Math.floor(data.event.reward * 0.2);
    if (win) this.systems.garage.addCash(reward);

    this.root.innerHTML = `
      <div class="vn-screen vn-results">
        <div class="vn-results-banner ${win?'win':'lose'}">
          ${win ? 'VICTORY' : 'DEFEATED'}
        </div>
        <div class="vn-results-data">
          <div class="vn-result-row"><span>POSITION</span><span>${pos}${['st','nd','rd'][pos-1]||'th'}</span></div>
          <div class="vn-result-row"><span>TIME</span><span>${mins}:${secs}</span></div>
          <div class="vn-result-row"><span>${win?'EARNINGS':'CONSOLATION'}</span><span>$${reward.toLocaleString()}</span></div>
        </div>
        ${win&&data.event.isMilestone?'<div class="vn-milestone-clear">MILESTONE CLEARED ✓</div>':''}
        <div class="vn-results-btns">
          <button class="vn-btn-primary" id="res-continue">CONTINUE</button>
          <button class="vn-btn-secondary" id="res-retry">RETRY</button>
        </div>
      </div>
    `;

    document.getElementById('res-continue')?.addEventListener('click', () => {
      if (win) {
        const r = this.systems.progression.completeEvent(
          data.event.stageId || 'stage_1', data.event.id, win ? 3 : 1
        );
        if (r.goldMastery) this._showGoldMastery(r);
        else this.showStageSelect();
      } else {
        this.showMainMenu();
      }
    });
    document.getElementById('res-retry')?.addEventListener('click', () => {
      window.VN?.raceManager?.stopRace?.();
      this._startQuickRace();
    });
  }

  _showGoldMastery(result) {
    this.root.innerHTML = `
      <div class="vn-screen vn-gold-screen">
        <div class="vn-gold-title">★ GOLD MASTERY ★</div>
        <div class="vn-gold-sub">ALL 25 EVENTS COMPLETED</div>
        <div class="vn-gold-unlocks">
          ${result.newUnlocks.map(u=>`<div class="vn-unlock-item">🔓 ${u.id.replace(/_/g,' ').toUpperCase()}</div>`).join('')}
        </div>
        <button class="vn-btn-primary" id="gold-ok">CONTINUE</button>
      </div>
    `;
    document.getElementById('gold-ok')?.addEventListener('click', () => this.showStageSelect());
  }

  _buildImpound(data) {
    const bail = data.bail;
    const strikes = data.strikes;
    this.root.innerHTML = `
      <div class="vn-screen vn-impound-screen">
        <div class="vn-impound-header">⚠ VEHICLE IMPOUNDED</div>
        <div class="vn-impound-detail">
          <div>STRIKES: ${strikes}/3</div>
          <div>BAIL AMOUNT: $${bail.toLocaleString()}</div>
          <div class="vn-impound-warn">${strikes>=3?'THIRD STRIKE — CAR WILL BE SEIZED WITHOUT BAIL':''}</div>
        </div>
        <div class="vn-impound-btns">
          <button class="vn-btn-primary" id="bail-pay">PAY BAIL ($${bail.toLocaleString()})</button>
          <button class="vn-btn-secondary" id="bail-skip">ABANDON CAR</button>
        </div>
      </div>
    `;

    document.getElementById('bail-pay')?.addEventListener('click', () => {
      const result = window.VN?.stakeSystem?.payBail(data.carId, window.VN?.garage?.cash);
      if (result?.success) {
        window.VN?.garage?.addCash(-bail);
        this.showMainMenu();
      }
    });
    document.getElementById('bail-skip')?.addEventListener('click', () => this.showMainMenu());
  }

  _buildPinkSlip(data) {
    this.root.innerHTML = `
      <div class="vn-screen vn-pinkslip-screen">
        <div class="vn-ps-title ${data.won?'won':'lost'}">
          ${data.won ? '🏆 PINK SLIP WON' : '💀 PINK SLIP LOST'}
        </div>
        <div class="vn-ps-desc">
          ${data.won
            ? `${data.carName} is now YOURS.`
            : `Your ${data.carName} belongs to ${data.opponent} now. Forever.`}
        </div>
        <button class="vn-btn-primary" id="ps-ok">I UNDERSTAND</button>
      </div>
    `;
    document.getElementById('ps-ok')?.addEventListener('click', () => this.showMainMenu());
  }

  _buildSettings() {
    const input = this.systems.input;
    this.root.innerHTML = `
      <div class="vn-screen vn-settings">
        <div class="vn-screen-header">
          <button class="vn-back-btn" id="settings-back">← BACK</button>
          <h2>SETTINGS</h2>
        </div>
        <div class="vn-settings-list">
          <div class="vn-setting-row">
            <span>CONTROLS</span>
            <div class="vn-toggle-group">
              <button class="vn-toggle ${input.mode==='tilt'?'active':''}" data-mode="tilt">TILT</button>
              <button class="vn-toggle ${input.mode==='buttons'?'active':''}" data-mode="buttons">BUTTONS</button>
            </div>
          </div>
          <div class="vn-setting-row">
            <span>AUDIO</span>
            <button class="vn-toggle active" id="audio-toggle">ON</button>
          </div>
          <div class="vn-setting-row">
            <span>CAMERA SHAKE</span>
            <button class="vn-toggle active" id="shake-toggle">ON</button>
          </div>
          <div class="vn-setting-row danger">
            <span>RESET PROGRESS</span>
            <button class="vn-btn-danger" id="reset-prog">RESET</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('settings-back')?.addEventListener('click', () => this.showMainMenu());
    this.root.querySelectorAll('.vn-toggle[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        input.setMode(btn.dataset.mode);
        this._buildSettings();
      });
    });
    document.getElementById('audio-toggle')?.addEventListener('click', e => {
      const muted = e.target.classList.toggle('inactive');
      this.systems.audio?.setMuted(muted);
      e.target.textContent = muted ? 'OFF' : 'ON';
    });
    document.getElementById('reset-prog')?.addEventListener('click', () => {
      if (confirm('Reset ALL progress? This cannot be undone.')) {
        this.systems.progression?.reset();
        this.systems.garage?.reset?.();
        this.showMainMenu();
      }
    });
  }

  // ─── GLOBAL STYLES ────────────────────────────────────────────────────────

  _injectStyles() {
    const style = document.createElement('style');
    style.textContent = VN_UI_CSS;
    document.head.appendChild(style);
  }
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

export class HUD {
  constructor(root) {
    this.root     = root;
    this._el      = null;
    this._visible = false;
    this._data    = {};
  }

  build() {
    const el = document.createElement('div');
    el.id = 'vn-hud';
    el.style.display = 'none';
    el.innerHTML = `
      <div id="hud-speed">
        <span id="hud-speed-val">0</span>
        <span id="hud-speed-unit">KM/H</span>
      </div>
      <div id="hud-gear">
        <span id="hud-gear-val">1</span>
        <span id="hud-gear-label">GEAR</span>
      </div>
      <div id="hud-rpm">
        <div id="hud-rpm-bar">
          <div id="hud-rpm-fill"></div>
          <div id="hud-rpm-redline"></div>
        </div>
      </div>
      <div id="hud-nos">
        <div id="hud-nos-bar"><div id="hud-nos-fill"></div></div>
        <span>N₂O</span>
      </div>
      <div id="hud-position">
        <span id="hud-pos-val">1</span>
        <span id="hud-pos-of">/6</span>
      </div>
      <div id="hud-lap">
        LAP <span id="hud-lap-val">1</span>/<span id="hud-lap-total">2</span>
      </div>
      <div id="hud-time"><span id="hud-time-val">0:00.000</span></div>
      <div id="hud-minimap">
        <canvas id="hud-minimap-canvas" width="120" height="120"></canvas>
      </div>
    `;
    this.root.appendChild(el);
    this._el = el;
  }

  show() { if (this._el) this._el.style.display = 'block'; this._visible = true; }
  hide() { if (this._el) this._el.style.display = 'none';  this._visible = false; }

  update(data) {
    if (!this._visible || !this._el) return;
    this._data = data;

    const q = id => document.getElementById(id);

    if (q('hud-speed-val'))  q('hud-speed-val').textContent  = data.speed;
    if (q('hud-gear-val'))   q('hud-gear-val').textContent   = data.gear;
    if (q('hud-pos-val'))    q('hud-pos-val').textContent    = data.position;
    if (q('hud-pos-of'))     q('hud-pos-of').textContent     = `/${data.totalOpponents}`;
    if (q('hud-lap-val'))    q('hud-lap-val').textContent    = data.lap;
    if (q('hud-lap-total'))  q('hud-lap-total').textContent  = data.totalLaps;

    // RPM bar
    const rpmPct = Math.min(100, (data.rpm / 9000) * 100);
    if (q('hud-rpm-fill')) q('hud-rpm-fill').style.width = rpmPct + '%';
    if (q('hud-rpm-fill')) q('hud-rpm-fill').style.background =
      rpmPct > 88 ? '#ff2200' : rpmPct > 75 ? '#ff6600' : '#00aaff';

    // Nitrous bar
    const nosPct = Math.round((data.nitrous || 0) * 100);
    if (q('hud-nos-fill')) q('hud-nos-fill').style.width = nosPct + '%';

    // Race timer
    if (q('hud-time-val')) {
      const m = Math.floor(data.raceTime / 60);
      const s = (data.raceTime % 60).toFixed(3);
      q('hud-time-val').textContent = `${m}:${s.padStart(6,'0')}`;
    }
  }

  tick(dt) {}
}

// ─── TUTORIAL ────────────────────────────────────────────────────────────────

export class Tutorial {
  constructor(ui, input) {
    this.ui    = ui;
    this.input = input;
    this._step = 0;
    this._onDone = null;
  }

  start(onDone) {
    this._onDone = onDone;
    this._step   = 0;
    this._showStep();
  }

  _showStep() {
    const steps = TUTORIAL_STEPS;
    if (this._step >= steps.length) {
      this._finish();
      return;
    }
    const step = steps[this._step];
    const ui   = document.createElement('div');
    ui.className = 'vn-tutorial-overlay';
    ui.innerHTML = `
      <div class="vn-tutorial-card">
        <div class="vn-tut-step">${this._step+1}/${steps.length}</div>
        <div class="vn-tut-icon">${step.icon}</div>
        <div class="vn-tut-title">${step.title}</div>
        <div class="vn-tut-body">${step.body}</div>
        ${step.image ? `<div class="vn-tut-diagram">${step.image}</div>` : ''}
        <div class="vn-tut-btns">
          ${this._step > 0 ? '<button class="vn-btn-secondary" id="tut-back">← BACK</button>' : ''}
          <button class="vn-btn-primary" id="tut-next">${this._step===steps.length-1?'LETS RACE →':'NEXT →'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(ui);
    document.getElementById('tut-next')?.addEventListener('click', () => {
      ui.remove();
      this._step++;
      this._showStep();
    });
    document.getElementById('tut-back')?.addEventListener('click', () => {
      ui.remove();
      this._step--;
      this._showStep();
    });
  }

  _finish() {
    if (this._onDone) this._onDone();
  }
}

const TUTORIAL_STEPS = [
  {
    icon:'🏁', title:'WELCOME TO VELOCITY NOIR',
    body:'A street-racing world where every race has consequences. Win big. Lose everything.',
  },
  {
    icon:'🎮', title:'TILT CONTROLS',
    body:'Tilt your phone LEFT or RIGHT to steer.\n\nTap the LEFT side of the screen to accelerate.\nTap the RIGHT side to brake.\nDouble-tap LEFT for a NITROUS burst.',
    image:`<svg viewBox="0 0 220 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="90" height="80" rx="8" fill="rgba(255,100,0,0.15)" stroke="#ff6600" stroke-width="1.5"/>
      <text x="55" y="55" text-anchor="middle" fill="#ff6600" font-size="11" font-family="monospace">TAP = GAS</text>
      <text x="55" y="72" text-anchor="middle" fill="#ff4400" font-size="9" font-family="monospace">DBL = N₂O</text>
      <rect x="120" y="10" width="90" height="80" rx="8" fill="rgba(0,150,255,0.12)" stroke="#0088ff" stroke-width="1.5"/>
      <text x="165" y="55" text-anchor="middle" fill="#0088ff" font-size="11" font-family="monospace">TAP = BRAKE</text>
      <path d="M105 50 L115 50" stroke="#fff" stroke-width="1" stroke-dasharray="3"/>
    </svg>`,
  },
  {
    icon:'🕹️', title:'BUTTON CONTROLS',
    body:'Prefer buttons? Switch in Settings.\n\n▲ = Accelerate  ▼ = Brake\n◀▶ = Steer\nN₂O button = Nitrous burst\nHAND BRAKE = Drift entry',
    image:`<svg viewBox="0 0 220 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="30" width="40" height="40" rx="6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
      <text x="40" y="56" text-anchor="middle" fill="white" font-size="16">▲</text>
      <rect x="20" y="75" width="40" height="20" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <text x="40" y="90" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="8">◀ ▼ ▶</text>
      <rect x="155" y="40" width="45" height="45" rx="22" fill="rgba(255,50,0,0.12)" stroke="rgba(255,80,0,0.5)" stroke-width="1.5"/>
      <text x="177" y="63" text-anchor="middle" fill="#ff6600" font-size="10" font-family="monospace">N₂O</text>
      <rect x="108" y="58" width="40" height="30" rx="6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
      <text x="128" y="78" text-anchor="middle" fill="white" font-size="18">●</text>
    </svg>`,
  },
  {
    icon:'🔥', title:'THE HEAT SYSTEM',
    body:'Get seen by police → HEAT rises.\n\nHeat 1-2: Cruiser chase\nHeat 3: Rhino SUVs — they go HEAD-ON\nHeat 4: Helicopter surveillance\nHeat 5: Supercar interceptors + EMP\n\nBreak line of sight to start the cooldown bar.',
  },
  {
    icon:'⚠️', title:'IMPOUND STRIKES',
    body:'Get BUSTED by police = 1 strike on your car.\n\n3 STRIKES → Your car is SEIZED.\n\nPay bail to recover it — or lose it forever.',
  },
  {
    icon:'💀', title:'PINK SLIPS',
    body:'Boss races are PINK SLIP events.\n\nLose → Your current car is PERMANENTLY given to the opponent.\n\nWin → Their custom ride is YOURS.',
  },
  {
    icon:'⚡', title:'NITROUS',
    body:'Nitrous refills automatically at HIGH SPEEDS.\n\nThere are no pit stops — drive dangerously to earn your boost.',
  },
  {
    icon:'🏆', title:'ARCADE GAUNTLET',
    body:'10 Stages · 25 events each.\n\n70% completion → Next stage unlocked.\n100% Gold Mastery → 2 LEGENDARY races + Extreme Weather track variant.',
  },
];

// ─── CSS ─────────────────────────────────────────────────────────────────────

const VN_UI_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Share+Tech+Mono&display=swap');

  :root {
    --vn-bg:        #080808;
    --vn-surface:   #0f0f0f;
    --vn-border:    rgba(255,255,255,0.08);
    --vn-accent:    #ff4400;
    --vn-accent2:   #ff8800;
    --vn-text:      #e8e8e8;
    --vn-muted:     #555;
    --vn-gold:      #d4a017;
    --vn-mono:      'Share Tech Mono', monospace;
    --vn-display:   'Barlow Condensed', sans-serif;
  }

  .vn-screen {
    position: absolute; inset: 0;
    background: var(--vn-bg);
    color: var(--vn-text);
    font-family: var(--vn-display);
    display: flex; flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
  }

  /* MAIN MENU */
  .vn-main-menu { justify-content: center; align-items: flex-start; padding: 40px 30px; }
  .vn-logo { font-size: clamp(3rem,10vw,5.5rem); font-weight:900; letter-spacing:0.05em;
    line-height:0.9; color:#fff; text-shadow: 3px 3px 0 var(--vn-accent); }
  .vn-logo-sub { font-size:0.65rem; letter-spacing:0.25em; color:var(--vn-muted);
    margin-top:8px; text-transform:uppercase; font-family:var(--vn-mono); }
  .vn-logo-block { margin-bottom: 40px; }
  .vn-menu-items { display:flex; flex-direction:column; gap:4px; width:100%; }
  .vn-menu-item { font-size:1.5rem; font-weight:700; letter-spacing:0.15em;
    padding: 14px 0; border-bottom: 1px solid var(--vn-border);
    cursor:pointer; transition: color 0.15s, padding-left 0.15s;
    text-transform:uppercase; }
  .vn-menu-item:hover, .vn-menu-item:active { color:var(--vn-accent); padding-left:12px; }
  .vn-menu-item.secondary { font-size:0.9rem; color:var(--vn-muted); }
  .vn-active-car { margin-top:auto; padding-top:20px; border-top:1px solid var(--vn-border); }
  .vn-active-car-label { font-size:0.6rem; letter-spacing:0.2em; color:var(--vn-muted); font-family:var(--vn-mono); }
  .vn-active-car-name { font-size:1.2rem; font-weight:700; margin:4px 0; }
  .vn-active-car-stats { display:flex; gap:16px; font-size:0.75rem; color:var(--vn-muted); font-family:var(--vn-mono); }
  .vn-cash-display { position:absolute; top:20px; right:20px; font-family:var(--vn-mono);
    font-size:1.1rem; color:var(--vn-accent2); letter-spacing:0.05em; }

  /* SCREEN HEADER */
  .vn-screen-header { display:flex; align-items:center; gap:12px; padding:16px 20px;
    border-bottom:1px solid var(--vn-border); flex-shrink:0; }
  .vn-screen-header h2 { font-size:1.4rem; font-weight:900; letter-spacing:0.1em; margin:0; flex:1; }
  .vn-header-sub { font-size:0.65rem; color:var(--vn-muted); font-family:var(--vn-mono); letter-spacing:0.1em; }
  .vn-back-btn { background:none; border:1px solid var(--vn-border); color:var(--vn-text);
    font-family:var(--vn-display); font-size:0.8rem; letter-spacing:0.1em; padding:6px 12px;
    cursor:pointer; border-radius:3px; }

  /* STAGE SELECT */
  .vn-stage-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:16px; overflow-y:auto; }
  .vn-stage-card { background:var(--vn-surface); border:1px solid var(--vn-border);
    padding:14px; border-radius:6px; cursor:pointer; transition:border-color 0.15s; }
  .vn-stage-card.unlocked:hover { border-color:var(--vn-accent); }
  .vn-stage-card.gold { border-color: var(--vn-gold); }
  .vn-stage-num { font-size:2rem; font-weight:900; color:rgba(255,255,255,0.12); line-height:1; }
  .vn-stage-name { font-size:0.85rem; font-weight:700; letter-spacing:0.05em; margin:4px 0; }
  .vn-stage-comp { display:flex; align-items:center; gap:8px; font-size:0.65rem; font-family:var(--vn-mono); color:var(--vn-muted); }
  .vn-comp-bar { flex:1; height:2px; background:rgba(255,255,255,0.1); }
  .vn-comp-bar div { height:100%; background:var(--vn-accent); }
  .vn-gold-badge { color:var(--vn-gold); font-weight:700; }

  /* EVENT LIST */
  .vn-event-scroll { overflow-y:auto; flex:1; padding:8px; }
  .vn-event-item { display:flex; align-items:center; gap:12px;
    padding:12px 14px; margin-bottom:6px; background:var(--vn-surface);
    border:1px solid var(--vn-border); border-radius:5px; cursor:pointer; }
  .vn-event-item.completed { border-left:3px solid var(--vn-accent); }
  .vn-event-item.milestone { border-left:3px solid var(--vn-accent2); }
  .vn-ev-num { font-size:1.2rem; font-weight:900; color:rgba(255,255,255,0.15); min-width:28px; }
  .vn-ev-info { flex:1; }
  .vn-ev-name { font-size:0.9rem; font-weight:700; }
  .vn-ev-type { font-size:0.6rem; color:var(--vn-muted); font-family:var(--vn-mono); letter-spacing:0.1em; margin-top:2px; }
  .vn-ev-reward { text-align:right; }
  .vn-ev-stars { color:var(--vn-gold); font-size:0.7rem; }
  .vn-ev-cash { font-size:0.75rem; font-family:var(--vn-mono); color:var(--vn-accent2); }

  /* BUTTONS */
  .vn-btn-primary { background:var(--vn-accent); color:#fff; border:none;
    font-family:var(--vn-display); font-size:1rem; font-weight:700;
    letter-spacing:0.15em; padding:14px 28px; cursor:pointer; border-radius:4px;
    text-transform:uppercase; width:100%; margin-top:12px; }
  .vn-btn-secondary { background:none; color:var(--vn-text); border:1px solid var(--vn-border);
    font-family:var(--vn-display); font-size:0.9rem; font-weight:700;
    letter-spacing:0.1em; padding:12px 20px; cursor:pointer; border-radius:4px;
    text-transform:uppercase; width:100%; margin-top:8px; }
  .vn-btn-danger { background:rgba(200,0,0,0.15); color:#ff4444; border:1px solid rgba(200,0,0,0.3);
    font-family:var(--vn-display); font-size:0.8rem; padding:8px 16px; cursor:pointer; border-radius:3px; }

  /* CONFIRM */
  .vn-confirm-race { justify-content:center; align-items:center; }
  .vn-confirm-card { background:var(--vn-surface); border:1px solid var(--vn-border);
    padding:28px 24px; border-radius:8px; width:90%; max-width:400px; }
  .vn-confirm-title { font-size:1.4rem; font-weight:900; letter-spacing:0.08em; margin-bottom:16px; }
  .vn-confirm-details { font-family:var(--vn-mono); font-size:0.75rem; color:var(--vn-muted); line-height:2; }
  .vn-confirm-car { margin:16px 0; font-size:0.8rem; font-weight:700; color:var(--vn-accent2); }
  .vn-milestone-req { color:var(--vn-accent); font-weight:700; margin-top:8px; }

  /* RESULTS */
  .vn-results { justify-content:center; align-items:center; padding:30px; }
  .vn-results-banner { font-size:clamp(3rem,12vw,6rem); font-weight:900; letter-spacing:0.1em;
    text-align:center; margin-bottom:24px; }
  .vn-results-banner.win { color:var(--vn-accent); text-shadow: 0 0 40px var(--vn-accent); }
  .vn-results-banner.lose { color:#555; }
  .vn-results-data { width:100%; max-width:360px; margin-bottom:24px; }
  .vn-result-row { display:flex; justify-content:space-between; padding:10px 0;
    border-bottom:1px solid var(--vn-border); font-family:var(--vn-mono); font-size:0.85rem; }
  .vn-milestone-clear { color:var(--vn-accent2); font-weight:700; letter-spacing:0.1em; margin-bottom:12px; }

  /* GARAGE */
  .vn-garage-tabs { display:flex; border-bottom:1px solid var(--vn-border); flex-shrink:0; }
  .vn-tab { flex:1; padding:12px; background:none; border:none; color:var(--vn-muted);
    font-family:var(--vn-display); font-size:0.8rem; letter-spacing:0.1em; cursor:pointer;
    text-transform:uppercase; border-bottom:2px solid transparent; }
  .vn-tab.active { color:var(--vn-text); border-bottom-color:var(--vn-accent); }
  .vn-garage-grid { display:flex; flex-direction:column; gap:8px; padding:12px; overflow-y:auto; }
  .vn-garage-car { background:var(--vn-surface); border:1px solid var(--vn-border);
    padding:14px; border-radius:6px; cursor:pointer; position:relative; }
  .vn-garage-car.active { border-color:var(--vn-accent); }
  .vn-garage-car.seized { border-color:rgba(200,0,0,0.4); opacity:0.7; }
  .vn-gc-name { font-size:1rem; font-weight:700; margin-bottom:4px; }
  .vn-gc-stats { display:flex; gap:12px; font-size:0.7rem; font-family:var(--vn-mono); color:var(--vn-muted); }
  .vn-gc-class { color:var(--vn-accent2); }
  .vn-gc-active-badge { position:absolute; top:10px; right:10px;
    background:var(--vn-accent); color:#fff; font-size:0.6rem; padding:2px 8px;
    border-radius:2px; letter-spacing:0.1em; font-weight:700; }
  .vn-gc-seized { color:#ff4444; font-size:0.7rem; font-family:var(--vn-mono); margin-top:4px; }
  .vn-gc-strikes { color:var(--vn-accent); font-size:0.8rem; margin-top:4px; }
  .vn-cash-header { font-family:var(--vn-mono); color:var(--vn-accent2); font-size:1rem; }

  /* GOLD MASTERY */
  .vn-gold-screen { justify-content:center; align-items:center; padding:40px 30px; }
  .vn-gold-title { font-size:clamp(2.5rem,10vw,5rem); font-weight:900; color:var(--vn-gold);
    text-shadow:0 0 30px var(--vn-gold); letter-spacing:0.1em; text-align:center; }
  .vn-gold-sub { font-family:var(--vn-mono); color:var(--vn-muted); letter-spacing:0.2em;
    font-size:0.7rem; margin:12px 0 24px; text-align:center; }
  .vn-gold-unlocks { width:100%; max-width:360px; margin-bottom:24px; }
  .vn-unlock-item { padding:10px 14px; background:rgba(212,160,23,0.08);
    border:1px solid rgba(212,160,23,0.2); border-radius:4px; margin-bottom:6px;
    font-size:0.8rem; font-family:var(--vn-mono); color:var(--vn-gold); }

  /* IMPOUND */
  .vn-impound-screen { justify-content:center; align-items:center; padding:40px 24px; }
  .vn-impound-header { font-size:2rem; font-weight:900; color:#ff4444;
    letter-spacing:0.1em; margin-bottom:24px; text-align:center; }
  .vn-impound-detail { font-family:var(--vn-mono); font-size:0.85rem; line-height:2.2;
    color:var(--vn-text); text-align:center; margin-bottom:24px; }
  .vn-impound-warn { color:var(--vn-accent); font-weight:700; }

  /* PINK SLIP */
  .vn-pinkslip-screen { justify-content:center; align-items:center; padding:40px 24px; }
  .vn-ps-title { font-size:clamp(2rem,8vw,3.5rem); font-weight:900; letter-spacing:0.08em;
    text-align:center; margin-bottom:16px; }
  .vn-ps-title.won  { color:var(--vn-accent2); }
  .vn-ps-title.lost { color:#ff4444; }
  .vn-ps-desc { font-size:1rem; text-align:center; max-width:320px; line-height:1.6;
    color:var(--vn-muted); margin-bottom:32px; }

  /* SETTINGS */
  .vn-settings-list { padding:16px; display:flex; flex-direction:column; gap:2px; overflow-y:auto; }
  .vn-setting-row { display:flex; justify-content:space-between; align-items:center;
    padding:16px 0; border-bottom:1px solid var(--vn-border); font-size:0.85rem;
    font-weight:700; letter-spacing:0.1em; }
  .vn-setting-row.danger span { color:#ff4444; }
  .vn-toggle-group { display:flex; gap:6px; }
  .vn-toggle { background:none; border:1px solid var(--vn-border); color:var(--vn-muted);
    font-family:var(--vn-display); font-size:0.75rem; padding:6px 14px; cursor:pointer;
    border-radius:3px; letter-spacing:0.1em; }
  .vn-toggle.active { background:rgba(255,68,0,0.15); border-color:var(--vn-accent); color:var(--vn-accent); }

  /* HUD */
  #vn-hud { position:fixed; inset:0; pointer-events:none; z-index:50; font-family:var(--vn-mono); }
  #hud-speed { position:absolute; bottom:22vh; left:20px;
    display:flex; flex-direction:column; align-items:flex-start; }
  #hud-speed-val { font-size:clamp(3rem,10vw,5rem); font-weight:700; color:#fff; line-height:0.9;
    text-shadow:0 0 15px rgba(255,255,255,0.3); }
  #hud-speed-unit { font-size:0.55rem; letter-spacing:0.2em; color:rgba(255,255,255,0.4); }
  #hud-gear { position:absolute; bottom:22vh; right:20px; text-align:right; }
  #hud-gear-val { font-size:clamp(3rem,10vw,5rem); font-weight:700; color:var(--vn-accent); line-height:0.9; }
  #hud-gear-label { font-size:0.55rem; letter-spacing:0.2em; color:rgba(255,255,255,0.4); }
  #hud-rpm { position:absolute; bottom:calc(22vh - 20px); left:20px; right:20px; }
  #hud-rpm-bar { height:3px; background:rgba(255,255,255,0.08); border-radius:2px; position:relative; }
  #hud-rpm-fill { height:100%; background:#00aaff; border-radius:2px; transition:width 0.04s, background 0.2s; box-shadow:0 0 6px currentColor; }
  #hud-nos { position:absolute; top:20px; left:50%; transform:translateX(-50%);
    display:flex; flex-direction:column; align-items:center; gap:4px; }
  #hud-nos-bar { width:80px; height:3px; background:rgba(255,255,255,0.08); border-radius:2px; }
  #hud-nos-fill { height:100%; background:#00ffaa; border-radius:2px; transition:width 0.1s; box-shadow:0 0 6px #00ffaa; }
  #hud-nos span { font-size:0.5rem; letter-spacing:0.2em; color:rgba(0,255,170,0.5); }
  #hud-position { position:absolute; top:20px; right:20px; text-align:right; }
  #hud-pos-val { font-size:1.8rem; font-weight:700; color:#fff; }
  #hud-pos-of { font-size:0.8rem; color:rgba(255,255,255,0.4); }
  #hud-lap { position:absolute; top:20px; left:20px; font-size:0.65rem; letter-spacing:0.15em;
    color:rgba(255,255,255,0.5); text-transform:uppercase; }
  #hud-time { position:absolute; top:40px; left:20px; }
  #hud-time-val { font-size:0.75rem; color:rgba(255,255,255,0.6); letter-spacing:0.05em; }
  #hud-minimap { position:absolute; bottom:calc(22vh + 10px); right:16px; }
  #hud-minimap-canvas { opacity:0.7; border-radius:50%; border:1px solid rgba(255,255,255,0.1); }

  /* TUTORIAL */
  .vn-tutorial-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.88);
    display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; }
  .vn-tutorial-card { background:var(--vn-surface); border:1px solid var(--vn-border);
    padding:32px 24px; border-radius:10px; width:100%; max-width:400px;
    font-family:var(--vn-display); }
  .vn-tut-step { font-size:0.6rem; letter-spacing:0.2em; color:var(--vn-muted);
    font-family:var(--vn-mono); margin-bottom:8px; }
  .vn-tut-icon { font-size:2.5rem; margin-bottom:12px; }
  .vn-tut-title { font-size:1.5rem; font-weight:900; letter-spacing:0.08em; margin-bottom:12px; }
  .vn-tut-body { font-size:0.85rem; line-height:1.7; color:rgba(255,255,255,0.7);
    white-space:pre-line; margin-bottom:16px; }
  .vn-tut-diagram { margin:16px 0; }
  .vn-tut-diagram svg { width:100%; height:auto; }
  .vn-tut-btns { display:flex; gap:10px; margin-top:8px; }
  .vn-tut-btns .vn-btn-primary, .vn-tut-btns .vn-btn-secondary { margin:0; }
`;

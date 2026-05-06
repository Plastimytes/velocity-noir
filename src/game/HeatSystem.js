/**
 * HeatSystem — 5-Level Police Pursuit Engine
 * Heat 1-2 : Cruisers  (agile, weak)
 * Heat 3   : Rhino SUVs (head-on charges, pairs)
 * Heat 4   : Rhinos + Helicopter surveillance
 * Heat 5+  : Supercar Interceptors + EMP + Helicopter + Roadblocks
 *
 * Pursuitbreakers: destructible objects knock out trailing cops
 * Hiding spots:   dark alleys/carwashes speed up cooldown bar
 * Impound strikes: 3 busts = car seized (unless bail paid)
 * Cost-to-State:  property damage accumulates, increases bounty
 */

export class HeatSystem {
  constructor(audio, ai) {
    this.audio = audio;
    this.ai    = ai;

    // ── Heat state ──────────────────────────────────────────────────────────
    this.heatLevel      = 0;        // 0-5
    this.heatPoints     = 0;        // accumulates → level up
    this.heatDecay      = false;    // true when in cooldown
    this.cooldownTimer  = 0;        // seconds remaining
    this.costToState    = 0;        // $ property damage
    this.isWanted       = false;

    // ── Cooldown ────────────────────────────────────────────────────────────
    this.cooldownNeeded = [0, 8, 15, 25, 40, 60];  // seconds per heat level
    this.inHidingSpot   = false;
    this.hidingBoost    = 2.5;      // cooldown multiplier when hiding

    // ── Pursuit units ───────────────────────────────────────────────────────
    this.activeCops     = [];       // { id, type, body, ai, disabled }
    this._maxCops       = [0, 2, 4, 6, 8, 12];

    // ── Radio chatter ───────────────────────────────────────────────────────
    this._radioLines    = RADIO_LINES;
    this._lastRadio     = 0;
    this._radioInterval = 8;        // seconds between chatter

    // ── Scanner ─────────────────────────────────────────────────────────────
    this._scannerEl     = null;
    this._buildScannerUI();

    // ── Helicopter ──────────────────────────────────────────────────────────
    this.helicopterActive  = false;
    this._heliSearchRadius = 80;    // metres, expands when LOS broken

    // ── Impound strikes ─────────────────────────────────────────────────────
    // Stored in StakeSystem, but tracked here per session
    this.sessionBusts = 0;

    // ── Pursuit breaker tracking ─────────────────────────────────────────────
    this._destroyedPBs  = new Set();  // pursuitBreaker IDs destroyed this chase

    // ── EMP ─────────────────────────────────────────────────────────────────
    this.empActive     = false;
    this.empTimer      = 0;

    // ── Callbacks ────────────────────────────────────────────────────────────
    this.onBust        = null;   // (carId) => void
    this.onHeatChange  = null;   // (level) => void
    this.onRadio       = null;   // (line) => void
  }

  // ─── MAIN UPDATE ──────────────────────────────────────────────────────────

  update(dt) {
    if (!this.isWanted) {
      this._passiveDecay(dt);
      return;
    }

    this._updateCooldown(dt);
    this._updateCops(dt);
    this._updateHelicopter(dt);
    this._updateEMP(dt);
    this._radioUpdate(dt);
    this._checkBust(dt);
  }

  // ─── HEAT ACCUMULATION ────────────────────────────────────────────────────

  addHeat(amount) {
    if (this.heatLevel >= 5) return;
    this.heatPoints += amount;
    const thresholds = [0, 100, 250, 500, 900, 1500];
    const newLevel   = thresholds.findIndex((t, i) =>
      this.heatPoints < (thresholds[i+1] || Infinity)
    );
    if (newLevel > this.heatLevel) {
      this.heatLevel = Math.min(5, newLevel);
      this._onHeatLevelUp();
    }
    this.isWanted    = this.heatLevel > 0;
    this.heatDecay   = false;
    this.cooldownTimer = 0;
  }

  addCostToState(amount) {
    this.costToState += amount;
    this.addHeat(amount / 500);  // $500 damage = 1 heat point
    this._updateScannerCTS();
  }

  startPursuit(playerCarId) {
    this.isWanted    = true;
    this.heatDecay   = false;
    this._playerCarId = playerCarId;
    if (this.heatLevel === 0) this.heatLevel = 1;
    this._spawnCopsForLevel();
    this._playDispatch('BOLO_START');
    if (this.onHeatChange) this.onHeatChange(this.heatLevel);
  }

  breakLineOfSight() {
    if (!this.isWanted) return;
    this.heatDecay   = true;
    this.cooldownTimer = this.cooldownNeeded[this.heatLevel];
    this._playDispatch('LOS_LOST');
  }

  enterHidingSpot(type) {
    // type: 'alley'|'carwash'|'garage'
    this.inHidingSpot = true;
    this._playDispatch('HIDING');
    this.audio?.playEffect('engine_off');
  }

  exitHidingSpot() {
    this.inHidingSpot = false;
  }

  // ─── COOLDOWN ────────────────────────────────────────────────────────────

  _updateCooldown(dt) {
    if (!this.heatDecay) return;
    const mult = this.inHidingSpot ? this.hidingBoost : 1.0;
    this.cooldownTimer -= dt * mult;
    if (this.cooldownTimer <= 0) {
      this._clearWanted();
    }
  }

  _clearWanted() {
    this.isWanted      = false;
    this.heatDecay     = false;
    this.heatLevel     = 0;
    this.heatPoints    = 0;
    this._despawnAllCops();
    this.helicopterActive = false;
    this.empActive        = false;
    this._playDispatch('LOST_SUSPECT');
    if (this.onHeatChange) this.onHeatChange(0);
    console.log('[HeatSystem] Pursuit cleared ✓');
  }

  _passiveDecay(dt) {
    if (this.heatPoints > 0 && !this.isWanted) {
      this.heatPoints = Math.max(0, this.heatPoints - dt * 2);
    }
  }

  // ─── LEVEL UP ─────────────────────────────────────────────────────────────

  _onHeatLevelUp() {
    console.log(`[HeatSystem] Heat level → ${this.heatLevel}`);
    this._spawnCopsForLevel();
    if (this.onHeatChange) this.onHeatChange(this.heatLevel);
    this._updateScannerHeat();

    if (this.heatLevel >= 4) {
      this.helicopterActive = true;
      this._playDispatch('HELI_DISPATCH');
    }
    if (this.heatLevel >= 5) {
      this._deployEMP();
      this._playDispatch('SUPERCAR_DISPATCH');
    }
  }

  // ─── COP SPAWNING ─────────────────────────────────────────────────────────

  _spawnCopsForLevel() {
    const needed  = this._maxCops[this.heatLevel] - this.activeCops.length;
    const type    = this._getCopTypeForLevel();
    for (let i = 0; i < needed; i++) {
      this._spawnCop(type);
    }
  }

  _getCopTypeForLevel() {
    if (this.heatLevel <= 2) return 'cruiser';
    if (this.heatLevel <= 3) return 'rhino';
    if (this.heatLevel <= 4) return 'rhino_heavy';
    return 'supercar';
  }

  _spawnCop(type) {
    const id = `cop_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const cop = {
      id, type,
      state: 'pursuing',   // pursuing | blocking | ramming | disabled
      pos: [0, 0, 0],      // set by AIDriver to spawn behind player
      vel: [0, 0, 0],
      heading: 0,
      disabled: false,
      disableTimer: 0,
      rhino_partner: null, // for Rhino pairs

      // Stats per type
      ...COP_STATS[type],
    };
    this.activeCops.push(cop);
    if (this.ai) this.ai.registerCop(cop, this._playerCarId);
    return cop;
  }

  _despawnAllCops() {
    for (const cop of this.activeCops) {
      if (this.ai) this.ai.unregisterCop(cop.id);
    }
    this.activeCops = [];
  }

  // ─── COP UPDATE ──────────────────────────────────────────────────────────

  _updateCops(dt) {
    for (const cop of this.activeCops) {
      if (cop.disabled) {
        cop.disableTimer -= dt;
        if (cop.disableTimer <= 0) cop.disabled = false;
        continue;
      }

      // Rhino pair head-on logic
      if (cop.type === 'rhino' || cop.type === 'rhino_heavy') {
        this._updateRhinoLogic(cop, dt);
      }
    }

    // Remove cops too far from player (> 300m)
    this.activeCops = this.activeCops.filter(c => {
      const dx = c.pos[0] - this._playerPos?.[0] || 0;
      const dz = c.pos[2] - this._playerPos?.[2] || 0;
      return Math.sqrt(dx*dx+dz*dz) < 300 || c.state === 'blocking';
    });
  }

  _updateRhinoLogic(cop, dt) {
    // Spawn Rhinos in pairs, approach from OPPOSITE lane
    if (!cop.rhino_partner) {
      const partner = this.activeCops.find(c =>
        c !== cop && (c.type === 'rhino' || c.type === 'rhino_heavy') && !c.rhino_partner
      );
      if (partner) { cop.rhino_partner = partner.id; partner.rhino_partner = cop.id; }
    }

    // Head-on approach: Rhino drives toward player from front
    if (cop.state === 'pursuing') {
      const player = this._playerPos || [0,0,0];
      const toPLayer = Math.sqrt(
        (cop.pos[0]-player[0])**2 + (cop.pos[2]-player[2])**2
      );
      if (toPLayer < 80) cop.state = 'ramming';
    }
  }

  // ─── BUST CHECK ──────────────────────────────────────────────────────────

  _checkBust(dt) {
    for (const cop of this.activeCops) {
      if (cop.disabled) continue;
      const player = this._playerPos || [0,0,0];
      const dist   = Math.sqrt(
        (cop.pos[0]-player[0])**2 + (cop.pos[2]-player[2])**2
      );
      const speed  = this._playerSpeed || 0;
      // Bust when cop is very close AND player is slow / stopped
      if (dist < 8 && speed < 25) {
        this._triggerBust();
        return;
      }
    }
  }

  _triggerBust() {
    this.sessionBusts++;
    this.isWanted   = false;
    this.heatLevel  = 0;
    this.heatPoints = 0;
    this._despawnAllCops();
    this._playDispatch('BUSTED');
    if (this.onBust) this.onBust(this._playerCarId, this.sessionBusts);
    console.log(`[HeatSystem] BUSTED! Strike ${this.sessionBusts}/3`);
  }

  // ─── PURSUIT BREAKERS ────────────────────────────────────────────────────

  triggerPursuitBreaker(pbId, nearbyRadius = 30) {
    if (this._destroyedPBs.has(pbId)) return;
    this._destroyedPBs.add(pbId);

    let disabled = 0;
    for (const cop of this.activeCops) {
      const player = this._playerPos || [0,0,0];
      const dx = cop.pos[0] - player[0];
      const dz = cop.pos[2] - player[2];
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist < nearbyRadius && !cop.disabled) {
        cop.disabled = true;
        cop.disableTimer = 12; // seconds out of commission
        disabled++;
      }
    }
    this.addCostToState(8000); // PBs are expensive
    console.log(`[HeatSystem] Pursuit breaker! ${disabled} cops disabled.`);
    this._playDispatch('PB_TRIGGERED');
    return disabled;
  }

  // ─── HELICOPTER ──────────────────────────────────────────────────────────

  _updateHelicopter(dt) {
    if (!this.helicopterActive) return;
    // Heli tracks player even through hiding spots (unless parked > 15s)
    if (this.inHidingSpot) {
      this._heliSearchRadius += dt * 5;
      if (this._heliSearchRadius > 200) {
        // Lost the helicopter
        this.helicopterActive = false;
        this._playDispatch('HELI_LOST');
      }
    } else {
      this._heliSearchRadius = Math.max(80, this._heliSearchRadius - dt * 20);
    }
  }

  // ─── EMP ─────────────────────────────────────────────────────────────────

  _deployEMP() {
    this.empActive = true;
    this.empTimer  = 6; // seconds of effect window
    this._playDispatch('EMP_DEPLOY');
  }

  _updateEMP(dt) {
    if (!this.empActive) return;
    this.empTimer -= dt;
    if (this.empTimer <= 0) this.empActive = false;
  }

  get isEMPActive()     { return this.empActive; }
  get copCount()        { return this.activeCops.filter(c=>!c.disabled).length; }
  get cooldownProgress(){ return this.cooldownTimer / (this.cooldownNeeded[this.heatLevel]||1); }

  // ─── RADIO CHATTER ───────────────────────────────────────────────────────

  _radioUpdate(dt) {
    this._lastRadio += dt;
    if (this._lastRadio >= this._radioInterval) {
      this._lastRadio = 0;
      const lines     = this._radioLines[this.heatLevel] || [];
      if (lines.length) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        this._showScanner(line);
        if (this.onRadio) this.onRadio(line);
      }
    }
  }

  _playDispatch(event) {
    const line = DISPATCH_EVENTS[event];
    if (line) this._showScanner(line);
    this.audio?.playEffect('police_radio');
  }

  // ─── SCANNER UI ──────────────────────────────────────────────────────────

  _buildScannerUI() {
    const el = document.createElement('div');
    el.id = 'vn-scanner';
    el.innerHTML = `
      <style>
        #vn-scanner {
          position: fixed; top: 0; left: 0; right: 0;
          display: flex; flex-direction: column; align-items: center;
          padding-top: 12px; z-index: 200; pointer-events: none;
        }
        #vn-heat-bar {
          display: flex; gap: 6px; margin-bottom: 8px;
        }
        .vn-heat-pip {
          width: 32px; height: 6px; border-radius: 2px;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          transition: background 0.3s;
        }
        .vn-heat-pip.active { background: #ff2200; box-shadow: 0 0 8px #ff2200; }
        .vn-heat-pip.max    { background: #ff0000; box-shadow: 0 0 12px #ff0000; animation: heatlamp 0.5s ease-in-out infinite alternate; }
        @keyframes heatlamp { from { opacity:1; } to { opacity:0.4; } }
        #vn-radio-text {
          font-family: 'Courier New', monospace;
          font-size: 10px;
          letter-spacing: 0.15em;
          color: rgba(80,200,100,0.85);
          background: rgba(0,0,0,0.65);
          padding: 4px 14px;
          border: 1px solid rgba(80,200,100,0.25);
          border-radius: 3px;
          opacity: 0;
          transition: opacity 0.3s;
          text-transform: uppercase;
          max-width: 90vw;
          text-align: center;
        }
        #vn-cts {
          font-family: 'Courier New', monospace;
          font-size: 9px;
          color: rgba(255,100,0,0.7);
          letter-spacing: 0.1em;
          margin-top: 4px;
        }
      </style>
      <div id="vn-heat-bar">
        ${[1,2,3,4,5].map(i=>`<div class="vn-heat-pip" id="pip-${i}"></div>`).join('')}
      </div>
      <div id="vn-radio-text">DISPATCH READY</div>
      <div id="vn-cts">COST TO STATE: $0</div>
    `;
    document.body.appendChild(el);
    this._scannerEl = el;
  }

  _showScanner(text) {
    const el = document.getElementById('vn-radio-text');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this._radioTimeout);
    this._radioTimeout = setTimeout(() => el.style.opacity = '0', 4000);
  }

  _updateScannerHeat() {
    for (let i = 1; i <= 5; i++) {
      const pip = document.getElementById(`pip-${i}`);
      if (!pip) continue;
      pip.className = 'vn-heat-pip';
      if (i <= this.heatLevel) {
        pip.classList.add(this.heatLevel >= 5 ? 'max' : 'active');
      }
    }
  }

  _updateScannerCTS() {
    const el = document.getElementById('vn-cts');
    if (el) el.textContent = `COST TO STATE: $${this.costToState.toLocaleString()}`;
  }

  // ─── PLAYER STATE SYNC ───────────────────────────────────────────────────
  // Called by RaceManager every frame

  syncPlayerState(pos, speed, heading) {
    this._playerPos    = pos;
    this._playerSpeed  = speed;
    this._playerHeading= heading;
    if (this.ai) this.ai.setPlayerState(pos, speed, heading);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COP UNIT STATS
// ═══════════════════════════════════════════════════════════════════════════════

const COP_STATS = {
  cruiser: {
    topSpeed: 220, acceleration: 6.5, mass: 1600,
    ramForce: 0.4, spikeDeploy: true, roadblock: false,
    color: [0.1, 0.2, 0.8],
  },
  rhino: {
    topSpeed: 195, acceleration: 7.0, mass: 2800,
    ramForce: 1.8, spikeDeploy: false, roadblock: true,
    color: [0.2, 0.2, 0.2],
  },
  rhino_heavy: {
    topSpeed: 190, acceleration: 7.5, mass: 3200,
    ramForce: 2.5, spikeDeploy: false, roadblock: true,
    color: [0.1, 0.1, 0.1],
  },
  supercar: {
    topSpeed: 320, acceleration: 4.2, mass: 1500,
    ramForce: 0.8, spikeDeploy: false, roadblock: false,
    color: [0.05, 0.05, 0.05],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// RADIO LINES (per heat level)
// ═══════════════════════════════════════════════════════════════════════════════

const RADIO_LINES = {
  1: [
    'DISPATCH: Suspect vehicle heading north on bridge.',
    'UNIT 4: Visual on suspect, initiating pursuit.',
    'DISPATCH: Suspect is a late-model coupe, dark color.',
    'UNIT 7: Speed estimated 140 km/h on the boulevard.',
  ],
  2: [
    'DISPATCH: Multiple units converging on suspect.',
    'UNIT 12: Requesting spike strip deployment at Route 7.',
    'DISPATCH: Suspect has evaded Unit 4, heading into industrial.',
    'UNIT 9: Roadblock set on the overpass, stand by.',
  ],
  3: [
    'DISPATCH: Upgrading pursuit — Rhino units authorized.',
    'UNIT RHINO-1: Heading toward suspect at highway junction.',
    'DISPATCH: Suspect causing massive property damage. CTS escalating.',
    'RHINO-2: Head-on approach authorized, brace yourselves.',
  ],
  4: [
    'AIR-1: Helicopter has visual, maintaining overhead.',
    'DISPATCH: Suspect cannot hide. Air support tracking.',
    'AIR-1: Suspect attempting to use underpass. Stand by.',
    'DISPATCH: All units — suspect is ARMED. Approach with extreme caution.',
  ],
  5: [
    'DISPATCH: Supercar interceptors SCRAMBLED. All units stand down.',
    'INTERCEPTOR-1: On suspect. Speed over 280. This ends now.',
    'DISPATCH: EMP deployment authorized at next junction.',
    'INTERCEPTOR-2: Road is clear ahead. We have them.',
    'DISPATCH: Suspect has caused over $500K cost to state. TERMINATE.',
  ],
};

const DISPATCH_EVENTS = {
  BOLO_START:       'DISPATCH: BOLO issued. All units respond.',
  LOS_LOST:         'DISPATCH: Suspect broke line of sight. Search pattern active.',
  HIDING:           'DISPATCH: Suspect vehicle not visible. Expanding search radius.',
  LOST_SUSPECT:     'DISPATCH: Suspect lost. All units return to patrol.',
  BUSTED:           'DISPATCH: SUSPECT IN CUSTODY. Code 4.',
  HELI_DISPATCH:    'AIR-1: Helicopter en route. We have eyes in the sky.',
  HELI_LOST:        'AIR-1: Lost visual. Suspect may have concealed vehicle.',
  SUPERCAR_DISPATCH:'DISPATCH: Interceptor units deployed. High-value pursuit.',
  EMP_DEPLOY:       'DISPATCH: EMP device authorized. Stand clear of junction.',
  PB_TRIGGERED:     'UNIT DOWN: Pursuit breaker activated! Officer assistance needed!',
};

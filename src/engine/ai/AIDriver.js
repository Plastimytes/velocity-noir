/**
 * AIDriver — Dual-purpose AI engine
 * 1. Racing AI  : rubber-band opponents, 4-8 per race
 * 2. Cop AI     : pursuit tactics per unit type
 *    - Cruiser  : standard chase, spike deployment
 *    - Rhino    : head-on paired approach
 *    - Supercar : high-speed intercept, block moves
 */

export class AIDriver {
  constructor() {
    this._racers    = new Map();   // id -> RacerAgent
    this._cops      = new Map();   // id -> CopAgent
    this._playerPos = [0,0,0];
    this._playerSpeed= 0;
    this._playerHeading = 0;
  }

  // ─── REGISTRATION ─────────────────────────────────────────────────────────

  registerRacer(id, body, difficulty = 0.7) {
    this._racers.set(id, new RacerAgent(id, body, difficulty));
  }

  registerCop(cop, playerCarId) {
    this._cops.set(cop.id, new CopAgent(cop));
  }

  unregisterCop(id)   { this._cops.delete(id); }
  unregisterRacer(id) { this._racers.delete(id); }
  clearAll()          { this._racers.clear(); this._cops.clear(); }

  setPlayerState(pos, speed, heading) {
    this._playerPos     = pos;
    this._playerSpeed   = speed;
    this._playerHeading = heading;
  }

  // ─── MAIN UPDATE ──────────────────────────────────────────────────────────

  update(dt) {
    for (const agent of this._racers.values()) agent.update(dt, this._playerPos, this._playerSpeed);
    for (const agent of this._cops.values())   agent.update(dt, this._playerPos, this._playerSpeed, this._playerHeading);
  }

  // ─── RUBBER-BAND HELPERS ──────────────────────────────────────────────────

  setTrackWaypoints(waypoints) {
    for (const agent of this._racers.values()) agent.setWaypoints(waypoints);
  }

  getLeaderboard() {
    const entries = Array.from(this._racers.values()).map(a => ({
      id: a.id, lapProgress: a.lapProgress, speed: a.speed
    }));
    entries.sort((a,b) => b.lapProgress - a.lapProgress);
    return entries;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RACER AGENT — Rubber-band racing AI
// ═══════════════════════════════════════════════════════════════════════════════

class RacerAgent {
  constructor(id, body, difficulty) {
    this.id         = id;
    this.body       = body;       // CarBody physics object
    this.difficulty = difficulty; // 0.5 (easy) – 1.0 (elite)

    // Waypoints
    this._waypoints  = [];
    this._waypointIdx= 0;
    this.lapProgress = 0;
    this.speed       = 0;

    // Rubber-band state
    this._rbThrottle = 0;
    this._rbTarget   = 0;

    // Steering lookahead
    this._steerErr   = 0;
    this._prevErr    = 0;
    this._steerKp    = 1.8;   // Proportional gain
    this._steerKd    = 0.4;   // Derivative gain (damping)

    // Crash recovery
    this._stuckTimer   = 0;
    this._reverseTimer = 0;
  }

  setWaypoints(wp) { this._waypoints = wp; this._waypointIdx = 0; }

  update(dt, playerPos, playerSpeed) {
    if (!this.body || !this._waypoints.length) return;

    const pos    = this.body.pos;
    this.speed   = this.body.speed;

    // ── Waypoint navigation ──────────────────────────────────────────────
    const target = this._getTargetWaypoint();
    const dx     = target[0] - pos[0];
    const dz     = target[2] - pos[2];
    const dist   = Math.sqrt(dx*dx + dz*dz);

    if (dist < 12) {
      this._waypointIdx = (this._waypointIdx + 1) % this._waypoints.length;
      this.lapProgress  = this._waypointIdx / this._waypoints.length;
    }

    // ── Steering (PD controller) ─────────────────────────────────────────
    const targetAngle = Math.atan2(dx, dz);
    const err         = this._angleDiff(targetAngle, this.body.heading);
    const dErr        = (err - this._prevErr) / dt;
    this._prevErr     = err;
    const steer       = Math.max(-1, Math.min(1, err * this._steerKp + dErr * this._steerKd));

    // ── Rubber-band throttle ──────────────────────────────────────────────
    const playerDist  = Math.sqrt(
      (pos[0]-playerPos[0])**2 + (pos[2]-playerPos[2])**2
    );
    // Far behind player? push throttle; far ahead? ease off
    const gapBoost    = Math.max(-0.25, Math.min(0.35, (playerDist - 30) / 120));
    const baseThrottle= 0.55 + this.difficulty * 0.35;
    this._rbTarget    = Math.max(0.1, Math.min(1.0, baseThrottle + gapBoost));
    this._rbThrottle += (this._rbTarget - this._rbThrottle) * dt * 3.0;

    // ── Braking on sharp corners ──────────────────────────────────────────
    const cornerErr = Math.abs(err);
    const brake     = cornerErr > 0.6 && this.speed > 80 ? cornerErr * 0.7 : 0;

    // ── Stuck detection ───────────────────────────────────────────────────
    if (this.speed < 5 && this._rbThrottle > 0.3) {
      this._stuckTimer += dt;
    } else {
      this._stuckTimer = 0;
    }
    if (this._stuckTimer > 2.5) {
      this._reverseTimer = 1.5;
      this._stuckTimer   = 0;
    }
    let throttle = this._rbThrottle;
    let finalBrake = brake;
    if (this._reverseTimer > 0) {
      this._reverseTimer -= dt;
      throttle   = 0;
      finalBrake = 1;
    }

    // ── Apply to physics body ────────────────────────────────────────────
    this.body.setInput(throttle, finalBrake, steer * this.difficulty);
  }

  _getTargetWaypoint() {
    // Lookahead by 2 waypoints at high speed
    const ahead = this.speed > 150 ? 2 : 1;
    const idx   = (this._waypointIdx + ahead) % this._waypoints.length;
    return this._waypoints[idx] || [0,0,0];
  }

  _angleDiff(a, b) {
    let d = a - b;
    while (d >  Math.PI) d -= Math.PI*2;
    while (d < -Math.PI) d += Math.PI*2;
    return d;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COP AGENT — Tactical pursuit AI
// ═══════════════════════════════════════════════════════════════════════════════

class CopAgent {
  constructor(cop) {
    this.cop         = cop;
    this.state       = 'intercept';   // intercept|block|headon|spike|disabled
    this._timer      = 0;
    this._target     = [0,0,0];
    this._predictAhead = 1.2;         // seconds to predict player position
  }

  update(dt, playerPos, playerSpeed, playerHeading) {
    if (this.cop.disabled) return;
    this._timer += dt;

    switch (this.cop.type) {
      case 'cruiser':    this._updateCruiser(dt, playerPos, playerSpeed, playerHeading); break;
      case 'rhino':
      case 'rhino_heavy':this._updateRhino(dt, playerPos, playerSpeed, playerHeading);  break;
      case 'supercar':   this._updateSupercar(dt, playerPos, playerSpeed, playerHeading);break;
    }
  }

  // ── CRUISER: standard pursuit + spike deployment ─────────────────────────
  _updateCruiser(dt, playerPos, playerSpeed, playerHeading) {
    // Predict player position
    const px = playerPos[0] + Math.sin(playerHeading)*playerSpeed/3.6*this._predictAhead;
    const pz = playerPos[2] + Math.cos(playerHeading)*playerSpeed/3.6*this._predictAhead;

    // Chase toward predicted position
    this._steerToward([px, 0, pz], dt);

    // Deploy spike strip when player is ahead and approaching
    if (this._timer > 12 && this._distToPlayer(playerPos) < 60 && this.cop.spikeDeploy) {
      this._deploySpikeStrip(playerPos, playerHeading);
      this._timer = 0;
    }
  }

  // ── RHINO: paired head-on charge ────────────────────────────────────────
  _updateRhino(dt, playerPos, playerSpeed, playerHeading) {
    if (this.cop.state === 'pursuing') {
      // Get AHEAD of player, then turn around for head-on
      const aheadX = playerPos[0] + Math.sin(playerHeading)*100;
      const aheadZ = playerPos[2] + Math.cos(playerHeading)*100;
      this._steerToward([aheadX, 0, aheadZ], dt);

      if (this._distToPlayer(playerPos) < 30) {
        this.cop.state = 'ramming';
      }
    } else if (this.cop.state === 'ramming') {
      // Drive directly at player (head-on)
      this._steerToward(playerPos, dt);
      this.cop.pos[0] += Math.sin(this.cop.heading) * (this.cop.topSpeed/3.6) * dt;
      this.cop.pos[2] += Math.cos(this.cop.heading) * (this.cop.topSpeed/3.6) * dt;
    }
  }

  // ── SUPERCAR: high-speed intercept, blocking maneuvers ──────────────────
  _updateSupercar(dt, playerPos, playerSpeed, playerHeading) {
    const dist = this._distToPlayer(playerPos);

    if (dist > 60) {
      // Sprint to catch up
      this._steerToward(playerPos, dt);
      const spd = this.cop.topSpeed / 3.6;
      this.cop.pos[0] += Math.sin(this.cop.heading) * spd * dt;
      this.cop.pos[2] += Math.cos(this.cop.heading) * spd * dt;
    } else {
      // Blocking maneuver: try to get alongside and cut in
      const sideOffset = (this._timer % 4 < 2) ? 4 : -4;
      const blockX = playerPos[0] + Math.cos(playerHeading)*sideOffset;
      const blockZ = playerPos[2] - Math.sin(playerHeading)*sideOffset;
      this._steerToward([blockX, 0, blockZ], dt);
    }
  }

  _steerToward(target, dt) {
    const dx = target[0] - this.cop.pos[0];
    const dz = target[2] - this.cop.pos[2];
    const targetAngle = Math.atan2(dx, dz);
    let diff = targetAngle - this.cop.heading;
    while (diff >  Math.PI) diff -= Math.PI*2;
    while (diff < -Math.PI) diff += Math.PI*2;
    this.cop.heading += Math.max(-2.5*dt, Math.min(2.5*dt, diff));

    const speed = (this.cop.topSpeed || 200) / 3.6;
    this.cop.pos[0] += Math.sin(this.cop.heading) * speed * dt;
    this.cop.pos[2] += Math.cos(this.cop.heading) * speed * dt;
  }

  _deploySpikeStrip(playerPos, playerHeading) {
    // Spawn a spike strip object 40m ahead of player
    const sx = playerPos[0] + Math.sin(playerHeading)*40;
    const sz = playerPos[2] + Math.cos(playerHeading)*40;
    // Emit event for RaceManager to place visual + collision
    window.VN?.raceManager?.spawnSpikeStrip?.(sx, sz, playerHeading);
    console.log('[CopAgent] Spike strip deployed!');
  }

  _distToPlayer(playerPos) {
    const dx = this.cop.pos[0] - playerPos[0];
    const dz = this.cop.pos[2] - playerPos[2];
    return Math.sqrt(dx*dx+dz*dz);
  }
}

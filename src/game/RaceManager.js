/**
 * RaceManager — Race Session Controller
 * Owns the active race loop, countdown, lap tracking,
 * opponent management, spike strip spawning, HUD data feed.
 */

export class RaceManager {
  constructor(systems) {
    Object.assign(this, systems);

    // ── Session state ─────────────────────────────────────────────────────
    this.state        = 'idle';   // idle|countdown|racing|finishing|results
    this.currentEvent = null;
    this.currentTrack = null;
    this._playerBodyId= null;
    this._playerInstId= null;

    // ── Timing ───────────────────────────────────────────────────────────
    this.raceTime     = 0;
    this.lapTimes     = [];
    this.currentLap   = 1;
    this._countdownTimer = 3;
    this._finishTimer    = 0;

    // ── Nitrous refill (speed-replenished) ────────────────────────────────
    this._nitrousFillRate = 0.005;   // per frame at high speed

    // ── Spike strips in world ─────────────────────────────────────────────
    this._spikeStrips = [];

    // ── Finish positions ──────────────────────────────────────────────────
    this.positions    = [];
    this.playerPos    = 0;

    // ── Camera shake ─────────────────────────────────────────────────────
    this._camShake    = 0;
    this._camOffset   = [0, 0, 0];

    // ── Camera settings ───────────────────────────────────────────────────
    this._camDist     = 7.0;
    this._camHeight   = 2.0;
    this._camLag      = 0.08;   // camera follow smoothing
    this._camPos      = [0, 2, -6];
    this._camTarget   = [0, 0, 0];
  }

  async init() {
    // Register all car meshes with the rendering engine
    const allCars = this.carDB?.getAll() || [];
    for (const car of allCars) {
      this.carEngine.registerCar(car.id, car);
    }
    console.log(`[RaceManager] Registered ${allCars.length} car meshes ✓`);
  }

  // ─── START RACE ───────────────────────────────────────────────────────────

  async startRace(event, carId) {
    console.log(`[RaceManager] Starting: ${event.name}`);
    this.state        = 'countdown';
    this.currentEvent = event;
    this.raceTime     = 0;
    this.lapTimes     = [];
    this.currentLap   = 1;
    this._countdownTimer = 3;
    this._spikeStrips = [];

    // Build/load track
    this.currentTrack = await this.trackBuilder.build(event);
    if (!this.currentTrack) { console.error('[RaceManager] Track build failed'); return; }

    // Spawn player car
    const carDef = this.carDB?.get(carId);
    if (!carDef) { console.error('[RaceManager] Car not found:', carId); return; }

    this._playerBodyId = `player`;
    const playerBody   = this.physics.createCarBody(this._playerBodyId, carDef);
    playerBody.pos     = [...this.currentTrack.startPos];
    playerBody.heading = this.currentTrack.startHeading;

    this._playerInstId = this.carEngine.spawnInstance(carId, {
      color:      carDef.paintColor || [0.8,0.1,0.05],
      metallic:   carDef.metallic,
      roughness:  carDef.roughness,
      orangePeel: carDef.orangePeel,
      flakes:     carDef.flakes,
    });

    // Spawn AI opponents
    const numOpponents = event.opponents || 5;
    this._spawnOpponents(numOpponents, carDef.tier || 1);

    // Set track waypoints for AI
    if (this.currentTrack.waypoints) {
      this.ai.setTrackWaypoints(this.currentTrack.waypoints);
    }

    // Start heat system
    this.heatSystem.syncPlayerState(playerBody.pos, 0, 0);

    // Reset camera
    this._camPos    = [...playerBody.pos];
    this._camPos[1] += this._camHeight;
    this._camPos[2] -= this._camDist;

    // Audio
    this.audio?.startEngineLoop(carDef.engineSound || 'default');
    this.audio?.playEffect('countdown_beep');
  }

  _spawnOpponents(count, playerTier) {
    const tierRange = [Math.max(1, playerTier-1), Math.min(3, playerTier+1)];
    for (let i = 0; i < count; i++) {
      const id      = `ai_${i}`;
      const cars    = this.carDB?.getAll().filter(c => c.tier >= tierRange[0] && c.tier <= tierRange[1]);
      const carDef  = cars?.[Math.floor(Math.random()*cars.length)];
      if (!carDef) continue;

      const body    = this.physics.createCarBody(id, carDef);
      const offset  = (i+1) * 5;
      body.pos      = [
        (this.currentTrack?.startPos[0] || 0) + (i%2 === 0 ? 2 : -2),
        this.currentTrack?.startPos[1] || 0,
        (this.currentTrack?.startPos[2] || 0) - offset,
      ];
      body.heading  = this.currentTrack?.startHeading || 0;

      const diff = 0.5 + (i / count) * 0.45;
      this.ai.registerRacer(id, body, diff);

      this.carEngine.spawnInstance(carDef.id, {
        color:    carDef.paintColor || [0.5,0.5,0.5],
        metallic: carDef.metallic,
        roughness:carDef.roughness,
      });
    }
  }

  // ─── MAIN UPDATE ──────────────────────────────────────────────────────────

  update(dt) {
    switch(this.state) {
      case 'countdown': this._updateCountdown(dt); break;
      case 'racing':    this._updateRacing(dt);    break;
      case 'finishing': this._updateFinishing(dt); break;
    }
    this._updateCamera(dt);
  }

  // ─── COUNTDOWN ───────────────────────────────────────────────────────────

  _updateCountdown(dt) {
    this._countdownTimer -= dt;
    if (this._countdownTimer <= 0) {
      this.state = 'racing';
      this.audio?.playEffect('race_start');
      console.log('[RaceManager] GO!');
    }
  }

  // ─── RACING ──────────────────────────────────────────────────────────────

  _updateRacing(dt) {
    this.raceTime += dt;

    const playerBody = this.physics.getBody(this._playerBodyId);
    if (!playerBody) return;

    // ── Input → physics ───────────────────────────────────────────────────
    const input = this.input.getState();
    playerBody.setInput(input.throttle, input.brake, input.steer, input.nitrous);

    // Speed-based nitrous refill
    if (playerBody.speed > 150) {
      playerBody.refilNitrous();
    }

    // ── Car model sync ────────────────────────────────────────────────────
    if (this._playerInstId) {
      this.carEngine.updateInstanceTransform(this._playerInstId, playerBody.getModelMatrix());
      this.carEngine.setBrakeHeat(this._playerInstId, playerBody.brakeHeat);
    }

    // ── Sync AI car models ─────────────────────────────────────────────────
    for (let i = 0; i < 8; i++) {
      const aiBody = this.physics.getBody(`ai_${i}`);
      if (aiBody) {
        this.carEngine.updateInstanceTransform(`ai_${i}`, aiBody.getModelMatrix());
      }
    }

    // ── Heat system sync ──────────────────────────────────────────────────
    this.heatSystem.syncPlayerState(playerBody.pos, playerBody.speed, playerBody.heading);

    // ── Camera shake from Group B suspension ─────────────────────────────
    const carDef = this.carDB?.get(this.currentEvent?.carId);
    if (carDef?.class === 'groupb') {
      this._camShake = Math.min(1, playerBody.speed / 300 * 0.8);
    } else {
      this._camShake = Math.min(0.4, playerBody.speed / 300 * 0.4);
    }

    // ── Spike strip collision ─────────────────────────────────────────────
    this._checkSpikeStrips(playerBody);

    // ── EMP effect ───────────────────────────────────────────────────────
    if (this.heatSystem.isEMPActive) {
      playerBody.setInput(0, 0.5, playerBody.steer); // kill throttle
    }

    // ── Render submission ─────────────────────────────────────────────────
    this._submitRenderables(playerBody);

    // ── Lap/finish check ──────────────────────────────────────────────────
    this._checkFinish(playerBody);

    // ── HUD data update ───────────────────────────────────────────────────
    this._updateHUD(playerBody);
  }

  _submitRenderables(playerBody) {
    if (!this.renderer) return;

    // Update camera
    this.renderer.setCamera(this._camPos, this._camTarget, 65);

    // Submit track meshes
    if (this.currentTrack?.meshes) {
      for (const { mesh, material, matrix } of this.currentTrack.meshes) {
        this.renderer.submitMesh(mesh, material, matrix);
      }
    }

    // Submit all car instances
    this.carEngine.renderAllCars(this.renderer.vpMatrix);

    // Submit particles (tire smoke, sparks)
    if (playerBody.speed > 80 && Math.abs(playerBody.angularVel) > 0.5) {
      this.renderer.particles?.emitTireSmoke(playerBody.pos, playerBody.heading);
    }
    if (playerBody.brakeHeat > 0.6) {
      this.renderer.particles?.emitBrakeSparks(playerBody.pos);
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────────────────

  _updateCamera(dt) {
    const body = this.physics.getBody(this._playerBodyId);
    if (!body) return;

    const cos_h = Math.cos(body.heading);
    const sin_h = Math.sin(body.heading);

    // Ideal camera position (behind and above car)
    const idealX = body.pos[0] - sin_h * this._camDist;
    const idealY = body.pos[1] + this._camHeight + (body.speed/300) * 0.5;
    const idealZ = body.pos[2] - cos_h * this._camDist;

    // Smooth follow
    const lag = this._camLag;
    this._camPos[0] += (idealX - this._camPos[0]) * (1 - Math.pow(lag, dt*60));
    this._camPos[1] += (idealY - this._camPos[1]) * (1 - Math.pow(lag, dt*60));
    this._camPos[2] += (idealZ - this._camPos[2]) * (1 - Math.pow(lag, dt*60));

    // Camera shake
    if (this._camShake > 0) {
      const shake = this._camShake * 0.04;
      this._camPos[0] += (Math.random()-0.5) * shake;
      this._camPos[1] += (Math.random()-0.5) * shake;
    }

    // Look at car
    this._camTarget = [body.pos[0], body.pos[1]+0.5, body.pos[2]];
  }

  // ─── SPIKE STRIPS ─────────────────────────────────────────────────────────

  spawnSpikeStrip(x, z, heading) {
    this._spikeStrips.push({ x, z, heading, active: true });
  }

  _checkSpikeStrips(body) {
    for (const strip of this._spikeStrips) {
      if (!strip.active) continue;
      const dx = body.pos[0] - strip.x;
      const dz = body.pos[2] - strip.z;
      if (Math.sqrt(dx*dx+dz*dz) < 4) {
        // Hit! Blow tires
        body.tireGrip *= 0.4;
        body.maxTorque *= 0.5;
        strip.active = false;
        this.heatSystem.addHeat(20);
        this.audio?.playEffect('tire_blowout');
        console.log('[RaceManager] Player hit spike strip!');
        // Damage flag
        this.carEngine.applyDamage(this._playerInstId, 'hang_bumper');
      }
    }
  }

  // ─── FINISH CHECK ────────────────────────────────────────────────────────

  _checkFinish(body) {
    if (!this.currentTrack?.finishLine) return;
    const fl = this.currentTrack.finishLine;
    const dx = body.pos[0] - fl[0];
    const dz = body.pos[2] - fl[2];
    const dist = Math.sqrt(dx*dx+dz*dz);

    if (dist < 8 && this.currentLap >= (this.currentEvent?.laps || 2)) {
      this._onRaceFinish();
    }
  }

  _onRaceFinish() {
    this.state = 'finishing';
    this._finishTimer = 4;
    const leaderboard = this.ai.getLeaderboard();
    this.playerPos    = 1; // simplified — real implementation uses lap progress comparison
    this.audio?.playEffect('race_finish');
    console.log(`[RaceManager] Race finished! Position: ${this.playerPos}`);
  }

  _updateFinishing(dt) {
    this._finishTimer -= dt;
    if (this._finishTimer <= 0) {
      this.state = 'results';
      // Notify UI
      window.VN?.ui?.showResults?.({
        position: this.playerPos,
        time:     this.raceTime,
        event:    this.currentEvent,
      });
    }
  }

  // ─── HUD DATA ─────────────────────────────────────────────────────────────

  _updateHUD(body) {
    // Emit to HUD component
    window.VN?.ui?.hud?.update({
      speed:          Math.round(body.speed),
      rpm:            Math.round(body.rpm),
      gear:           body.gear,
      nitrous:        body.nitrousLevel,
      heat:           this.heatSystem.heatLevel,
      heatDecaying:   this.heatSystem.heatDecay,
      cooldownProg:   this.heatSystem.cooldownProgress,
      raceTime:       this.raceTime,
      lap:            this.currentLap,
      totalLaps:      this.currentEvent?.laps || 2,
      position:       this.playerPos,
      totalOpponents: (this.currentEvent?.opponents || 5) + 1,
      brakeHeat:      body.brakeHeat,
      damage:         body.bodyDamage,
      stakeStrikes:   this.stakeSystem.getStrikes(this._playerBodyId),
    });
  }

  stopRace() {
    this.state = 'idle';
    this.physics.removeBody(this._playerBodyId);
    for (let i = 0; i < 8; i++) this.physics.removeBody(`ai_${i}`);
    this.ai.clearAll();
    this.heatSystem._despawnAllCops?.();
    this._spikeStrips = [];
    this.audio?.stopEngineLoop();
    console.log('[RaceManager] Race stopped.');
  }
}

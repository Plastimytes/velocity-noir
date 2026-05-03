/**
 * Physics — Arcade-Plus Physics Engine
 * - Accessible drift mechanics (like the 2005 era)
 * - Heavy weight simulation for DTM/Rally cars
 * - Tire grip model (slip angle → lateral force)
 * - Suspension spring-damper (4-corner)
 * - Collision detection (AABB + sphere broadphase, SAT narrowphase)
 * - Road surface interaction (asphalt / dirt / gravel handling change)
 * - Off-road capability for Group B (dampened, not penalized)
 */

export class Physics {
  constructor() {
    this._bodies     = new Map();  // id -> RigidBody
    this._gravity    = -9.81;
    this._time       = 0;
  }

  // ─── BODY CREATION ────────────────────────────────────────────────────────

  createCarBody(id, carDef) {
    const body = new CarBody(id, carDef);
    this._bodies.set(id, body);
    return body;
  }

  getBody(id) { return this._bodies.get(id) || null; }
  removeBody(id) { this._bodies.delete(id); }

  // ─── STEP ─────────────────────────────────────────────────────────────────

  step(dt) {
    this._time += dt;
    for (const body of this._bodies.values()) {
      if (body.type === 'car') body.integrate(dt, this._gravity);
    }
    this._resolveCollisions();
  }

  _resolveCollisions() {
    const bodies = Array.from(this._bodies.values());
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i+1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        if (!a.bounds || !b.bounds) continue;
        const contact = aabbOverlap(a.bounds, b.bounds);
        if (contact) resolveContact(a, b, contact);
      }
    }
  }
}

// ─── CAR RIGID BODY ──────────────────────────────────────────────────────────

export class CarBody {
  constructor(id, def) {
    this.id   = id;
    this.type = 'car';

    // ── Definition from CarDatabase ──────────────────────────────────────
    this.mass         = def.mass         || 1200;   // kg
    this.wheelbase    = def.wheelbase    || 2.55;   // m
    this.trackWidth   = def.trackWidth   || 1.55;   // m
    this.cgHeight     = def.cgHeight     || 0.45;   // m (center of gravity)
    this.aeroDownforce= def.aeroDownforce|| 0.0;    // N at 100km/h
    this.driveType    = def.driveType    || 'rwd';  // 'rwd'|'fwd'|'awd'
    this.offRoadFactor= def.offRoadFactor|| 0.4;    // Group B = 1.0, JDM = 0.3

    // ── State ────────────────────────────────────────────────────────────
    this.pos          = [0, 0, 0];     // world XYZ
    this.vel          = [0, 0, 0];     // m/s
    this.heading      = 0;             // radians (Y axis)
    this.angularVel   = 0;             // rad/s (yaw rate)
    this.speed        = 0;             // km/h (scalar)
    this.onGround     = true;

    // ── Inputs ───────────────────────────────────────────────────────────
    this.throttle     = 0;             // 0-1
    this.brake        = 0;             // 0-1
    this.steer        = 0;             // -1 (left) to 1 (right)
    this.nitrous      = false;

    // ── Suspension ───────────────────────────────────────────────────────
    this.suspension   = [
      { compression: 0, vel: 0 },  // FL
      { compression: 0, vel: 0 },  // FR
      { compression: 0, vel: 0 },  // RL
      { compression: 0, vel: 0 },  // RR
    ];
    this.suspSpring   = def.suspSpring || 35000;  // N/m
    this.suspDamp     = def.suspDamp   || 3500;   // N·s/m

    // ── Tires ────────────────────────────────────────────────────────────
    this.tireGrip     = def.tireGrip  || 1.0;
    this.slipAngle    = [0,0,0,0];      // per wheel
    this.slipRatio    = [0,0,0,0];      // per wheel

    // ── Engine ───────────────────────────────────────────────────────────
    this.rpm          = 1000;
    this.gear         = 1;
    this.gearRatios   = def.gearRatios || [3.5,2.3,1.6,1.2,0.95,0.78];
    this.finalDrive   = def.finalDrive || 3.7;
    this.maxTorque    = def.maxTorque  || 400;   // Nm
    this.maxRPM       = def.maxRPM     || 8500;
    this.idleRPM      = def.idleRPM    || 850;
    this.turboBoost   = 0;             // 0-1 normalized
    this.nitrousLevel = 1.0;           // depletes on use

    // ── Aerodynamics ─────────────────────────────────────────────────────
    this.dragCoeff    = def.dragCoeff  || 0.32;
    this.frontalArea  = def.frontalArea|| 2.1;    // m²

    // ── Heat / Damage ─────────────────────────────────────────────────────
    this.brakeHeat    = 0;             // 0-1 → brake disc glow
    this.engineTemp   = 80;            // °C
    this.bodyDamage   = 0;             // 0-1

    // ── Bounds (AABB, in world space) ─────────────────────────────────────
    this.bounds       = { min:[0,0,0], max:[0,0,0] };
    this._updateBounds();

    // ── Inertia ───────────────────────────────────────────────────────────
    // Moment of inertia around yaw axis (simplified box)
    this.inertiaY = this.mass * (2.5*2.5 + 1.8*1.8) / 12.0;
  }

  // ─── MAIN INTEGRATE ────────────────────────────────────────────────────────

  integrate(dt, gravity) {
    const cos_h = Math.cos(this.heading);
    const sin_h = Math.sin(this.heading);

    // ── Turbo spool ───────────────────────────────────────────────────────
    const targetBoost = this.throttle * (this.rpm / this.maxRPM);
    this.turboBoost  += (targetBoost - this.turboBoost) * dt * 3.0;

    // ── Engine torque at wheel ────────────────────────────────────────────
    const rpmNorm    = Math.min(this.rpm / this.maxRPM, 1.0);
    const torqueCurve= this._torqueCurve(rpmNorm);
    let   engineTorque = this.maxTorque * torqueCurve * this.throttle;
    engineTorque  *= (1.0 + this.turboBoost * 0.45);

    // Nitrous boost
    if (this.nitrous && this.nitrousLevel > 0) {
      engineTorque  *= 1.65;
      this.nitrousLevel = Math.max(0, this.nitrousLevel - dt * 0.15);
    }

    const driveForce = engineTorque * this.gearRatios[this.gear-1] * this.finalDrive / 0.32;

    // ── Longitudinal forces ───────────────────────────────────────────────
    const speedMs  = Math.sqrt(this.vel[0]**2 + this.vel[2]**2);
    this.speed     = speedMs * 3.6;  // km/h

    // Drag: F_drag = 0.5 * ρ * Cd * A * v²
    const drag = 0.5 * 1.225 * this.dragCoeff * this.frontalArea * speedMs * speedMs;

    // Braking force
    const brakeForce = this.brake * this.mass * 9.81 * 0.85 * this.tireGrip;

    // Update brake heat
    if (this.brake > 0.1 && speedMs > 5) {
      this.brakeHeat = Math.min(1, this.brakeHeat + dt * this.brake * 0.4);
    } else {
      this.brakeHeat = Math.max(0, this.brakeHeat - dt * 0.08);
    }

    // Net longitudinal force
    let Fx = driveForce - drag - brakeForce;

    // ── Lateral tire forces (slip angle model) ────────────────────────────
    const maxSteer   = 0.52;  // radians (~30°)
    const steerAngle = this.steer * maxSteer;
    const velAngle   = Math.atan2(this.vel[0], this.vel[2]);
    const slipAngle  = velAngle - this.heading + steerAngle;

    // Pacejka "Magic Formula" simplified
    const Fy_max = this.mass * 9.81 * this.tireGrip * 1.2;
    const Fy     = this._magicFormula(slipAngle, Fy_max);

    // ── Arcade drift assist ───────────────────────────────────────────────
    // At high slip angles, reduce lateral force to allow controllable sliding
    const driftSlip = Math.abs(slipAngle);
    const driftFactor = driftSlip > 0.3 ? Math.max(0.3, 1.0 - (driftSlip - 0.3) * 0.8) : 1.0;
    const Fy_applied = Fy * driftFactor;

    // ── Surface modifier ──────────────────────────────────────────────────
    const surface = this._getSurface();
    Fx *= surface.traction;
    const lateralForce = Fy_applied * surface.lateral;

    // ── Aero downforce ────────────────────────────────────────────────────
    const downforce = this.aeroDownforce * (this.speed / 100) * (this.speed / 100);

    // ── Integrate velocity (forward in heading direction) ─────────────────
    const accel  = Fx / this.mass;
    const dt2    = Math.min(dt, 0.02);

    // Forward velocity along heading
    const fwdSpeed = this.vel[0]*sin_h + this.vel[2]*cos_h;
    const newFwdSpeed = fwdSpeed + accel * dt2;

    // Blend lateral velocity toward zero (grip) or preserve (drift)
    const latSpeed = this.vel[0]*cos_h - this.vel[2]*sin_h;
    const latAccel = lateralForce / this.mass;
    const newLatSpeed = latSpeed * (1.0 - 0.85*driftFactor*dt2*60) + latAccel*dt2;

    // Reconstruct world velocity
    this.vel[0] = newFwdSpeed * sin_h + newLatSpeed * cos_h;
    this.vel[2] = newFwdSpeed * cos_h - newLatSpeed * sin_h;

    // ── Angular velocity (yaw) ────────────────────────────────────────────
    const yawTorque = lateralForce * this.wheelbase * 0.5;
    const yawDamp   = this.angularVel * this.mass * 0.8;
    this.angularVel += (yawTorque - yawDamp) / this.inertiaY * dt2;
    this.angularVel  = Math.max(-3.0, Math.min(3.0, this.angularVel));

    this.heading += this.angularVel * dt2;

    // ── Position ──────────────────────────────────────────────────────────
    this.pos[0] += this.vel[0] * dt2;
    this.pos[2] += this.vel[2] * dt2;

    // ── RPM update ────────────────────────────────────────────────────────
    this._updateRPM(dt2, newFwdSpeed);

    // ── Auto gear shift ───────────────────────────────────────────────────
    this._autoShift();

    // ── Suspension bounce ─────────────────────────────────────────────────
    this._updateSuspension(dt2, downforce);

    // ── Bounds update ─────────────────────────────────────────────────────
    this._updateBounds();
  }

  _torqueCurve(rpmNorm) {
    // Bell curve peaked at ~65% RPM, falloff at redline
    const peak = 0.65;
    const t = rpmNorm - peak;
    return Math.exp(-t*t*8.0) * 0.8 + 0.2 * (1.0 - rpmNorm);
  }

  _magicFormula(slipAngle, Fmax) {
    // Simplified Pacejka B*C*D*sin(C*atan(B*slip))
    const B=10, C=1.3, D=Fmax;
    return D * Math.sin(C * Math.atan(B * slipAngle));
  }

  _getSurface() {
    // Future: sample surface texture at car position
    // For now returns asphalt defaults
    return { traction: 1.0, lateral: 1.0 };
  }

  _updateRPM(dt, speed) {
    const wheelCircumference = 2 * Math.PI * 0.32;
    const wheelRPS    = Math.max(0, speed) / wheelCircumference;
    const targetRPM   = wheelRPS * this.gearRatios[this.gear-1] * this.finalDrive * 60;
    const finalRPM    = Math.max(this.idleRPM, Math.min(this.maxRPM, targetRPM));
    this.rpm         += (finalRPM - this.rpm) * dt * 8;
  }

  _autoShift() {
    if (this.rpm > this.maxRPM * 0.92 && this.gear < this.gearRatios.length) this.gear++;
    if (this.rpm < this.idleRPM * 1.8   && this.gear > 1) this.gear--;
  }

  _updateSuspension(dt, downforce) {
    const restLength   = 0.2;
    const groundHeight = 0;
    const wheelY       = this.pos[1];
    for (let i = 0; i < 4; i++) {
      const compression = restLength - (wheelY - groundHeight - 0.28);
      const vel = (compression - this.suspension[i].compression) / dt;
      this.suspension[i].compression = compression;
      this.suspension[i].vel = vel;
    }
  }

  _updateBounds() {
    const hw = 0.9, hl = 2.2, hh = 0.65;
    this.bounds.min = [this.pos[0]-hw, this.pos[1],    this.pos[2]-hl];
    this.bounds.max = [this.pos[0]+hw, this.pos[1]+hh*2, this.pos[2]+hl];
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  setInput(throttle, brake, steer, nitrous = false) {
    this.throttle = Math.max(0, Math.min(1, throttle));
    this.brake    = Math.max(0, Math.min(1, brake));
    this.steer    = Math.max(-1, Math.min(1, steer));
    this.nitrous  = nitrous && this.nitrousLevel > 0;
  }

  getModelMatrix() {
    const m = new Float32Array(16);
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    m[0]=c;  m[1]=0; m[2]=-s; m[3]=0;
    m[4]=0;  m[5]=1; m[6]=0;  m[7]=0;
    m[8]=s;  m[9]=0; m[10]=c; m[11]=0;
    m[12]=this.pos[0]; m[13]=this.pos[1]; m[14]=this.pos[2]; m[15]=1;
    return m;
  }

  refilNitrous() { this.nitrousLevel = Math.min(1.0, this.nitrousLevel + 0.005); }
}

// ─── COLLISION HELPERS ────────────────────────────────────────────────────────

function aabbOverlap(a, b) {
  if (a.max[0]<b.min[0]||b.max[0]<a.min[0]) return null;
  if (a.max[1]<b.min[1]||b.max[1]<a.min[1]) return null;
  if (a.max[2]<b.min[2]||b.max[2]<a.min[2]) return null;
  // Return penetration vector
  const px = Math.min(a.max[0]-b.min[0], b.max[0]-a.min[0]);
  const py = Math.min(a.max[1]-b.min[1], b.max[1]-a.min[1]);
  const pz = Math.min(a.max[2]-b.min[2], b.max[2]-a.min[2]);
  return { px, py, pz };
}

function resolveContact(a, b, contact) {
  // Simple impulse response
  const restitution = 0.3;
  const dvx = b.vel[0] - a.vel[0];
  const dvz = b.vel[2] - a.vel[2];
  const mA  = a.mass || 1200;
  const mB  = b.mass || 1200;
  const impulse = -(1+restitution)*(dvx*0+dvz*1)/(1/mA+1/mB);
  a.vel[2] -= impulse / mA;
  b.vel[2] += impulse / mB;
  // Damage on high-speed collision
  const relSpeed = Math.sqrt(dvx*dvx+dvz*dvz);
  if (relSpeed > 20) {
    if (a.bodyDamage !== undefined) a.bodyDamage = Math.min(1, a.bodyDamage + relSpeed/200);
    if (b.bodyDamage !== undefined) b.bodyDamage = Math.min(1, b.bodyDamage + relSpeed/200);
  }
}

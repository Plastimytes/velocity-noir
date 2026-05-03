/**
 * GarageManager — Car Ownership, Upgrades & Customization
 */

export class GarageManager {
  constructor(carDB, stakeSystem) {
    this.carDB       = carDB;
    this.stakeSystem = stakeSystem;

    this._ownedCars  = new Map();   // carId → OwnedCar
    this._cash       = 0;
    this._activeCar  = null;

    this._load();
    if (this._ownedCars.size === 0) this._giveStarterCars();
  }

  // ─── STARTER CARS ────────────────────────────────────────────────────────

  _giveStarterCars() {
    const starters = ['ae86_trueno', 'honda_integra_dc2', 'golf_gti_mk2'];
    for (const id of starters) {
      const def = this.carDB?.get(id);
      if (def) this._addCar(id, def, true);
    }
    this._activeCar = 'ae86_trueno';
    this._cash      = 15000;
    this._save();
  }

  _addCar(carId, def, free = false) {
    this._ownedCars.set(carId, {
      id:       carId,
      def,
      paint: {
        color:      def.paintColor || [0.8,0.1,0.05],
        metallic:   def.metallic   ?? 0.7,
        roughness:  def.roughness  ?? 0.25,
        orangePeel: def.orangePeel ?? 0.3,
        flakes:     def.flakes     ?? 0.5,
      },
      upgrades: { engine:0, turbo:0, suspension:0, brakes:0, tires:0, aero:0 },
      mileage:  0,
      decals:   [],
      bodyKit:  def.bodyKit || 'stock',
    });
  }

  // ─── BUYING / SELLING ────────────────────────────────────────────────────

  buyCar(carId) {
    const def = this.carDB?.get(carId);
    if (!def)             return { success:false, reason:'Unknown car' };
    if (this.owns(carId)) return { success:false, reason:'Already owned' };
    if (this._cash < def.price) return { success:false, reason:'Insufficient funds', need: def.price - this._cash };

    this._cash -= def.price;
    this._addCar(carId, def);
    this._save();
    return { success:true, newCash: this._cash };
  }

  sellCar(carId) {
    if (!this.owns(carId))        return { success:false, reason:'Not owned' };
    if (this._activeCar === carId) return { success:false, reason:'Cannot sell active car' };
    const def      = this._ownedCars.get(carId).def;
    const sellPrice= Math.floor(def.price * 0.55);
    this._ownedCars.delete(carId);
    this._cash += sellPrice;
    this._save();
    return { success:true, sold: sellPrice, newCash: this._cash };
  }

  // ─── UPGRADES ────────────────────────────────────────────────────────────

  upgrade(carId, part) {
    const car = this._ownedCars.get(carId);
    if (!car) return { success:false };
    const currentLevel = car.upgrades[part] || 0;
    if (currentLevel >= 5) return { success:false, reason:'Max level' };
    const cost = UPGRADE_COSTS[part]?.[currentLevel] || 9999;
    if (this._cash < cost) return { success:false, reason:'Insufficient funds', need: cost - this._cash };

    this._cash -= cost;
    car.upgrades[part] = currentLevel + 1;
    this._applyUpgradeBonus(car, part, currentLevel + 1);
    this._save();
    return { success:true, newLevel: currentLevel+1, cost, newCash: this._cash };
  }

  _applyUpgradeBonus(car, part, level) {
    const def = car.def;
    const multipliers = UPGRADE_MULTIPLIERS[part]?.[level-1] || 1.0;
    switch(part) {
      case 'engine':    def.maxTorque   *= multipliers; break;
      case 'turbo':     def.maxTorque   *= multipliers; def.maxRPM *= 1.02; break;
      case 'suspension':def.tireGrip   += 0.04; def.suspSpring *= 1.1; break;
      case 'brakes':    def.suspDamp   += 200; break;
      case 'tires':     def.tireGrip   += 0.06; def.dragCoeff *= 0.98; break;
      case 'aero':      def.aeroDownforce += 150; def.dragCoeff *= 1.02; break;
    }
  }

  // ─── CUSTOMIZATION ───────────────────────────────────────────────────────

  setPaint(carId, paintDef) {
    const car = this._ownedCars.get(carId);
    if (!car) return;
    Object.assign(car.paint, paintDef);
    this._save();
  }

  addDecal(carId, decal) {
    const car = this._ownedCars.get(carId);
    if (!car) return;
    if (car.decals.length >= 50) car.decals.shift(); // max 50 layers
    car.decals.push(decal);
    this._save();
  }

  setBodyKit(carId, kit) {
    const car = this._ownedCars.get(carId);
    if (!car) return;
    car.bodyKit = kit;
    this._save();
  }

  setActiveCar(carId) {
    if (!this.owns(carId) || this.stakeSystem.isSeized(carId)) return false;
    this._activeCar = carId;
    this._save();
    return true;
  }

  // ─── QUERIES ─────────────────────────────────────────────────────────────

  owns(carId)        { return this._ownedCars.has(carId); }
  getCar(carId)      { return this._ownedCars.get(carId) || null; }
  getActiveCar()     { return this._ownedCars.get(this._activeCar) || null; }
  getActiveCarId()   { return this._activeCar; }
  getAllOwned()       { return Array.from(this._ownedCars.values()); }
  get cash()         { return this._cash; }

  addCash(amount) { this._cash += amount; this._save(); }

  getAvailableForRace() {
    return this.getAllOwned().filter(c => !this.stakeSystem.isSeized(c.id));
  }

  // ─── PERSISTENCE ──────────────────────────────────────────────────────────

  _save() {
    try {
      const carsData = {};
      for (const [id, car] of this._ownedCars) {
        carsData[id] = { upgrades: car.upgrades, paint: car.paint, mileage: car.mileage, decals: car.decals, bodyKit: car.bodyKit };
      }
      localStorage.setItem('vn_garage', JSON.stringify({ cars: carsData, cash: this._cash, active: this._activeCar }));
    } catch(e) {}
  }

  _load() {
    try {
      const raw = localStorage.getItem('vn_garage');
      if (!raw) return;
      const data = JSON.parse(raw);
      this._cash      = data.cash   || 0;
      this._activeCar = data.active || null;
      for (const [id, saved] of Object.entries(data.cars || {})) {
        const def = this.carDB?.get(id);
        if (!def) continue;
        this._addCar(id, { ...def });
        const car = this._ownedCars.get(id);
        if (car) {
          car.upgrades = saved.upgrades || car.upgrades;
          car.paint    = saved.paint    || car.paint;
          car.mileage  = saved.mileage  || 0;
          car.decals   = saved.decals   || [];
          car.bodyKit  = saved.bodyKit  || def.bodyKit;
          // Re-apply upgrades to def
          for (const [part, level] of Object.entries(car.upgrades)) {
            for (let l = 0; l < level; l++) this._applyUpgradeBonus(car, part, l+1);
          }
        }
      }
    } catch(e) {}
  }
}

const UPGRADE_COSTS = {
  engine:    [8000,  18000, 35000, 65000, 120000],
  turbo:     [12000, 25000, 50000, 90000, 160000],
  suspension:[4000,  9000,  18000, 35000, 65000 ],
  brakes:    [3000,  7000,  14000, 28000, 55000 ],
  tires:     [3500,  8000,  16000, 32000, 60000 ],
  aero:      [5000,  11000, 22000, 45000, 85000 ],
};

const UPGRADE_MULTIPLIERS = {
  engine:    [1.08, 1.10, 1.12, 1.15, 1.20],
  turbo:     [1.10, 1.12, 1.15, 1.18, 1.25],
  suspension:[1.0,  1.0,  1.0,  1.0,  1.0 ],
  brakes:    [1.0,  1.0,  1.0,  1.0,  1.0 ],
  tires:     [1.0,  1.0,  1.0,  1.0,  1.0 ],
  aero:      [1.0,  1.0,  1.0,  1.0,  1.0 ],
};

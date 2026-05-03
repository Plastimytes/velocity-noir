/**
 * StakeSystem — High-stakes ownership consequences
 *
 * Pink Slips : Lose a Boss race → current car is PERMANENTLY removed
 * Impound    : 3 cop busts → car is SEIZED (pay bail or lose it)
 * Bounty     : High cost-to-state adds a wanted bounty to your profile
 */

export class StakeSystem {
  constructor() {
    this._carStrikes = {};    // carId → strike count (0-3)
    this._seizedCars = new Set();
    this._bailAmounts= {};    // carId → bail cost in $
    this._history    = [];    // log of all stake events

    this._load();
  }

  // ─── BUST / IMPOUND ───────────────────────────────────────────────────────

  addBustStrike(carId, costToState = 0) {
    if (!this._carStrikes[carId]) this._carStrikes[carId] = 0;
    this._carStrikes[carId]++;

    const strikes = this._carStrikes[carId];
    const bail    = this._calculateBail(carId, costToState);
    this._bailAmounts[carId] = (this._bailAmounts[carId] || 0) + bail;

    const event = {
      type:   'bust',
      carId,
      strikes,
      bail,
      costToState,
      timestamp: Date.now(),
    };
    this._history.push(event);

    if (strikes >= 3) {
      this._seizeVehicle(carId);
    }

    this._save();
    console.log(`[StakeSystem] BUST! Car ${carId} — Strike ${strikes}/3. Bail: $${bail.toLocaleString()}`);
    return { strikes, bail, seized: strikes >= 3 };
  }

  _seizeVehicle(carId) {
    this._seizedCars.add(carId);
    this._history.push({ type: 'seized', carId, timestamp: Date.now() });
    console.warn(`[StakeSystem] CAR SEIZED: ${carId}`);
  }

  payBail(carId, playerCash) {
    const bail = this._bailAmounts[carId] || 0;
    if (playerCash < bail) return { success: false, bail };

    this._seizedCars.delete(carId);
    this._carStrikes[carId] = 0;
    delete this._bailAmounts[carId];
    this._history.push({ type: 'bail_paid', carId, amount: bail, timestamp: Date.now() });
    this._save();
    console.log(`[StakeSystem] Bail paid for ${carId}: $${bail.toLocaleString()}`);
    return { success: true, bail, newCash: playerCash - bail };
  }

  _calculateBail(carId, costToState) {
    const baseMultiplier = 1500;
    const strikes = this._carStrikes[carId] || 1;
    return Math.floor((baseMultiplier * strikes) + (costToState * 0.35));
  }

  // ─── PINK SLIPS ───────────────────────────────────────────────────────────

  /**
   * Called when a pink-slip race (boss race) is LOST.
   * The wagered car is permanently transferred to opponent.
   */
  forfeitPinkSlip(losingCarId, winnerName) {
    const event = {
      type:   'pink_slip_lost',
      carId:  losingCarId,
      winner: winnerName,
      timestamp: Date.now(),
    };
    this._history.push(event);
    this._seizedCars.add(losingCarId);   // Mark as gone from garage
    this._save();
    console.warn(`[StakeSystem] PINK SLIP LOST! ${losingCarId} → ${winnerName}`);
    return event;
  }

  /**
   * Called when a pink-slip race is WON.
   * The opponent's car is transferred to the player.
   */
  gainPinkSlip(newCarId, previousOwner) {
    const event = {
      type:   'pink_slip_won',
      carId:  newCarId,
      from:   previousOwner,
      timestamp: Date.now(),
    };
    this._history.push(event);
    this._save();
    console.log(`[StakeSystem] PINK SLIP WON! ${newCarId} from ${previousOwner}`);
    return event;
  }

  // ─── QUERIES ─────────────────────────────────────────────────────────────

  getStrikes(carId)    { return this._carStrikes[carId] || 0; }
  isSeized(carId)      { return this._seizedCars.has(carId); }
  getBail(carId)       { return this._bailAmounts[carId] || 0; }
  getHistory()         { return [...this._history]; }

  getCarStatus(carId) {
    return {
      strikes: this.getStrikes(carId),
      seized:  this.isSeized(carId),
      bail:    this.getBail(carId),
    };
  }

  // ─── PERSISTENCE ─────────────────────────────────────────────────────────

  _save() {
    try {
      localStorage.setItem('vn_stakes', JSON.stringify({
        strikes:  this._carStrikes,
        seized:   Array.from(this._seizedCars),
        bail:     this._bailAmounts,
        history:  this._history.slice(-50), // keep last 50
      }));
    } catch(e) {}
  }

  _load() {
    try {
      const raw = localStorage.getItem('vn_stakes');
      if (!raw) return;
      const data = JSON.parse(raw);
      this._carStrikes = data.strikes || {};
      this._seizedCars = new Set(data.seized || []);
      this._bailAmounts= data.bail    || {};
      this._history    = data.history || [];
    } catch(e) {}
  }

  reset() {
    this._carStrikes = {};
    this._seizedCars = new Set();
    this._bailAmounts= {};
    this._history    = [];
    this._save();
  }
}

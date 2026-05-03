/**
 * ProgressionManager — 10-Stage Arcade Gauntlet
 *
 * Structure:
 *   10 Stages × 25 events each
 *   70% completion  → unlocks next stage
 *   100% completion → Gold Mastery
 *                   → Unlocks 2 Legendary races
 *                   → Unlocks Extreme Weather variant
 *
 * Event Types: Circuit | Sprint | Speedtrap | Tollbooth | Bounty | Pursuit
 * Milestone events (70% gate): bounty/pursuit challenges
 */

export class ProgressionManager {
  constructor() {
    this._stages   = this._buildAllStages();
    this._progress = {};   // stageId → { completed: Set<eventId>, stars: {} }
    this._unlocks  = new Set();
    this._load();
  }

  // ─── STAGE ACCESS ─────────────────────────────────────────────────────────

  getStage(stageId)    { return this._stages.find(s => s.id === stageId) || null; }
  getAllStages()        { return this._stages; }
  getUnlockedStages()  { return this._stages.filter(s => this.isStageUnlocked(s.id)); }

  isStageUnlocked(stageId) {
    if (stageId === 'stage_1') return true;
    const prev = this._stages[this._stages.findIndex(s=>s.id===stageId)-1];
    if (!prev) return false;
    return this.getStageCompletion(prev.id) >= 0.70;
  }

  isGoldMastery(stageId) { return this.getStageCompletion(stageId) >= 1.0; }
  isUnlocked(itemId)     { return this._unlocks.has(itemId); }

  getStageCompletion(stageId) {
    const stage = this.getStage(stageId);
    if (!stage) return 0;
    const prog  = this._progress[stageId];
    if (!prog)  return 0;
    return prog.completed.size / stage.events.length;
  }

  getEventStatus(stageId, eventId) {
    const prog = this._progress[stageId];
    if (!prog) return { completed: false, stars: 0 };
    return {
      completed: prog.completed.has(eventId),
      stars:     prog.stars[eventId] || 0,
    };
  }

  // ─── COMPLETE EVENT ───────────────────────────────────────────────────────

  completeEvent(stageId, eventId, stars = 1) {
    if (!this._progress[stageId]) {
      this._progress[stageId] = { completed: new Set(), stars: {} };
    }
    const prog = this._progress[stageId];
    const wasNew = !prog.completed.has(eventId);
    prog.completed.add(eventId);
    prog.stars[eventId] = Math.max(prog.stars[eventId] || 0, stars);

    const completion = this.getStageCompletion(stageId);
    const results    = { stageId, eventId, stars, completion, newUnlocks: [] };

    // ── 70% Gate ─────────────────────────────────────────────────────────
    if (wasNew && completion >= 0.70 && completion < 0.70 + (1/25)) {
      const nextStage = this._stages[this._stages.findIndex(s=>s.id===stageId)+1];
      if (nextStage) {
        results.newUnlocks.push({ type: 'stage', id: nextStage.id });
        console.log(`[Progression] Stage unlocked: ${nextStage.id}`);
      }
    }

    // ── 100% Gold Mastery ─────────────────────────────────────────────────
    if (wasNew && completion >= 1.0) {
      const stage = this.getStage(stageId);
      if (stage.goldRewards) {
        for (const reward of stage.goldRewards) {
          this._unlocks.add(reward);
          results.newUnlocks.push({ type: 'gold_reward', id: reward });
        }
      }
      results.goldMastery = true;
      console.log(`[Progression] GOLD MASTERY: ${stageId}`);
    }

    this._save();
    return results;
  }

  // ─── STAGE BUILDER ────────────────────────────────────────────────────────

  _buildAllStages() {
    const stages = [];
    for (let i = 1; i <= 10; i++) {
      stages.push(this._buildStage(i));
    }
    return stages;
  }

  _buildStage(num) {
    const themes = [
      { name: 'Industrial Harbour',   track: 'shipyard',    weather: 'overcast' },
      { name: 'Brutalist City',       track: 'downtown',    weather: 'dusk'     },
      { name: 'Pine Forest Pass',     track: 'forest',      weather: 'fog'      },
      { name: 'Mountain Serpentine',  track: 'mountain',    weather: 'clear'    },
      { name: 'Night Motorway',       track: 'highway',     weather: 'night'    },
      { name: 'Coastal Cliffs',       track: 'coastal',     weather: 'windy'    },
      { name: 'Underground District', track: 'underground', weather: 'rain'     },
      { name: 'Airport Perimeter',    track: 'airport',     weather: 'dusk'     },
      { name: 'Abandoned Expressway', track: 'expressway',  weather: 'night'    },
      { name: 'The Final Circuit',    track: 'finalcircuit',weather: 'storm'    },
    ];
    const t = themes[num-1];

    const events = this._buildEvents(num, t.track);

    return {
      id:          `stage_${num}`,
      number:      num,
      name:        `Stage ${num}: ${t.name}`,
      track:       t.track,
      weather:     t.weather,
      events,
      goldRewards: [
        `legendary_race_${num}_a`,
        `legendary_race_${num}_b`,
        `weather_extreme_${t.track}`,
        num === 10 ? 'car_quattro_s1_evo2_boss' : `car_bonus_stage_${num}`,
      ],
      minCarTier:  Math.max(1, Math.floor(num / 3)),
      heatLevel:   Math.min(5, Math.floor(num / 2)),
    };
  }

  _buildEvents(stageNum, trackId) {
    const events = [];
    const types  = ['circuit','sprint','speedtrap','tollbooth','sprint','circuit',
                    'speedtrap','tollbooth','circuit','sprint'];
    const milestoneAt = [7, 14, 21]; // bounty/pursuit milestone positions
    const legendaryAt = [24, 25];    // final 2 = legendary unlocked via gold

    for (let i = 1; i <= 25; i++) {
      const isMilestone  = milestoneAt.includes(i);
      const isLegendary  = legendaryAt.includes(i);
      const type = isMilestone ? 'milestone' :
                   isLegendary ? 'legendary' :
                   types[(i-1) % types.length];

      events.push({
        id:          `${trackId}_evt_${i}`,
        number:      i,
        type,
        name:        this._eventName(type, i, stageNum),
        laps:        type === 'circuit' ? (stageNum > 6 ? 3 : 2) : 1,
        opponents:   Math.min(8, 3 + Math.floor(stageNum / 2)),
        difficulty:  Math.min(1.0, 0.4 + stageNum * 0.06),
        reward:      this._eventReward(type, stageNum),
        milestoneReq:isMilestone ? this._milestoneReq(stageNum, i) : null,
        isMilestone,
        isLegendary,
      });
    }
    return events;
  }

  _eventName(type, num, stage) {
    const names = {
      circuit:    [`Sprint Circuit ${num}`, `Race Circuit ${num}`, `Grand Loop ${num}`],
      sprint:     [`Point-to-Point ${num}`, `Sprint Run ${num}`,   `Blast ${num}`],
      speedtrap:  [`Speed Trap ${num}`,     `Radar Run ${num}`,    `Velocity Check ${num}`],
      tollbooth:  [`Tollbooth ${num}`,      `Gate Race ${num}`,    `Checkpoint ${num}`],
      milestone:  [`Bounty: Stage ${stage}`, `Pursuit Challenge`, `Cost-to-State Run`],
      legendary:  [`Legendary: The Gauntlet`, `Legendary: Last Stand`],
    };
    const opts = names[type] || [`Event ${num}`];
    return opts[num % opts.length];
  }

  _eventReward(type, stage) {
    const base = stage * 2500;
    const mult = { circuit:1.0, sprint:0.8, speedtrap:0.6, tollbooth:0.7, milestone:2.5, legendary:5.0 };
    return Math.floor(base * (mult[type] || 1.0));
  }

  _milestoneReq(stage, eventNum) {
    const reqs = [
      { type: 'pursuit_duration', value: 60 + stage * 30, label: `Survive pursuit for ${60+stage*30}s` },
      { type: 'cost_to_state',    value: stage * 15000,   label: `Cause $${(stage*15000).toLocaleString()} damage` },
      { type: 'near_misses',      value: 5 + stage,       label: `${5+stage} near-misses` },
    ];
    return reqs[(eventNum - 1) % reqs.length];
  }

  // ─── PERSISTENCE ─────────────────────────────────────────────────────────

  _save() {
    try {
      const data = {};
      for (const [id, prog] of Object.entries(this._progress)) {
        data[id] = {
          completed: Array.from(prog.completed),
          stars: prog.stars,
        };
      }
      localStorage.setItem('vn_progression', JSON.stringify({
        progress: data,
        unlocks:  Array.from(this._unlocks),
      }));
    } catch(e) {}
  }

  _load() {
    try {
      const raw = localStorage.getItem('vn_progression');
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const [id, prog] of Object.entries(saved.progress || {})) {
        this._progress[id] = {
          completed: new Set(prog.completed),
          stars: prog.stars || {},
        };
      }
      this._unlocks = new Set(saved.unlocks || []);
    } catch(e) {}
  }

  reset() {
    this._progress = {};
    this._unlocks  = new Set();
    this._save();
  }
}

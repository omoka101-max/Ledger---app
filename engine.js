/**
 * RPEngine — autoregulated training progression.
 * Pure functions, no DOM. Works in Node (tests) and browser (<script src="engine.js">).
 *
 * Two modes:
 *  - hypertrophy: volume-landmark autoregulation (MEV -> MRV set progression)
 *  - strength:    block-periodized load autoregulation (RIR-based, e1RM tracking)
 */
(function (root) {
  'use strict';

  // ---------- shared enums ----------
  const PUMP = { NONE: 0, LOW: 1, MODERATE: 2, HIGH: 3 };
  const SORENESS = { NONE: 0, HEALED_EARLY: 1, HEALED_ON_TIME: 2, STILL_SORE: 3 };
  const JOINT_PAIN = { NONE: 0, SOME: 1, A_LOT: 2 };
  const PERFORMANCE = { WORSE: -1, SAME: 0, BETTER: 1 };

  // ============================================================
  // HYPERTROPHY MODE
  // ============================================================

  /**
   * Decide next week's set target for a muscle group.
   * @param {Object} state - { mev, mav, mrv, currentSets, weekInMeso, mesoLength, consecutiveWorse }
   * @param {Object} feedback - { pump, soreness, jointPain, performance }
   * @returns {Object} { nextSets, deloadNext, reason }
   */
  function hypertrophyWeeklyAdjustment(state, feedback) {
    const { mev, mav, mrv, currentSets, weekInMeso, mesoLength, consecutiveWorse = 0 } = state;
    const { pump, soreness, jointPain, performance } = feedback;

    // Hard stop: end of scheduled meso length -> deload regardless of feedback
    if (weekInMeso >= mesoLength) {
      return { nextSets: mev, deloadNext: true, reason: 'Scheduled end of mesocycle — deload.' };
    }

    // Joint pain is a hard ceiling signal, not a soft one.
    if (jointPain === JOINT_PAIN.A_LOT) {
      const reduced = Math.max(mev, currentSets - 2);
      return { nextSets: reduced, deloadNext: false, reason: 'Significant joint pain — cut volume, consider exercise swap.' };
    }

    // Non-recovery: still sore going into this session AND performance dropped.
    // That combination is the RP "you went too far" signal.
    if (soreness === SORENESS.STILL_SORE && performance === PERFORMANCE.WORSE) {
      return { nextSets: mev, deloadNext: true, reason: 'Unrecovered + performance drop — deload now, do not wait for scheduled end.' };
    }

    // Already at/over MRV — cannot add more, must hold or back off.
    if (currentSets >= mrv) {
      if (performance === PERFORMANCE.WORSE || soreness === SORENESS.STILL_SORE) {
        return { nextSets: mev, deloadNext: true, reason: 'At MRV and showing overreach signs — deload.' };
      }
      return { nextSets: currentSets, deloadNext: false, reason: 'At MRV, still recovering OK — hold, do not add more.' };
    }

    // Two consecutive worse-performance weeks, even without soreness flag, is a fatigue signal.
    if (performance === PERFORMANCE.WORSE && consecutiveWorse >= 1) {
      return { nextSets: Math.max(mev, currentSets - 1), deloadNext: false, reason: 'Two straight weeks of declining performance — pull back.' };
    }

    // Undershooting: recovered easily, low pump, sets still well below MAV -> ramp faster (+2)
    if (soreness <= SORENESS.HEALED_EARLY && jointPain === JOINT_PAIN.NONE &&
        performance !== PERFORMANCE.WORSE && pump <= PUMP.LOW && currentSets < mav) {
      return { nextSets: Math.min(mrv, currentSets + 2), deloadNext: false, reason: 'Recovering fast, low fatigue cost — add 2 sets.' };
    }

    // Normal progression: healed on time, performance held or improved -> +1 set
    if (soreness <= SORENESS.HEALED_ON_TIME && performance !== PERFORMANCE.WORSE && jointPain !== JOINT_PAIN.A_LOT) {
      return { nextSets: Math.min(mrv, currentSets + 1), deloadNext: false, reason: 'On track — standard +1 set progression.' };
    }

    // Default: hold volume, gather more data.
    return { nextSets: currentSets, deloadNext: false, reason: 'Mixed signals — hold volume this week.' };
  }

  function startHypertrophyMeso({ mev, mav, mrv, mesoLength = 5 }) {
    return {
      mev, mav, mrv, mesoLength,
      currentSets: mev,
      weekInMeso: 1,
      consecutiveWorse: 0,
      history: [],
    };
  }

  /** Apply one week's feedback to a muscle's meso state, returns new state. */
  function advanceHypertrophyWeek(muscleState, feedback) {
    const decision = hypertrophyWeeklyAdjustment(muscleState, feedback);
    const consecutiveWorse = feedback.performance === PERFORMANCE.WORSE
      ? muscleState.consecutiveWorse + 1
      : 0;

    const history = muscleState.history.concat([{
      week: muscleState.weekInMeso,
      setsPlanned: muscleState.currentSets,
      feedback,
      decision,
    }]);

    if (decision.deloadNext) {
      return {
        ...muscleState,
        currentSets: muscleState.mev,
        weekInMeso: 1,
        consecutiveWorse: 0,
        history,
        justDeloaded: true,
      };
    }

    return {
      ...muscleState,
      currentSets: decision.nextSets,
      weekInMeso: muscleState.weekInMeso + 1,
      consecutiveWorse,
      history,
      justDeloaded: false,
    };
  }

  // ============================================================
  // STRENGTH / POWERLIFTING MODE
  // ============================================================

  const BLOCKS = ['accumulation', 'intensification', 'peak', 'deload'];

  // Target RIR by block and week-within-block (1-indexed). Falls back to last value if week exceeds array.
  const BLOCK_RIR_SCHEME = {
    accumulation: [4, 3, 3, 2],
    intensification: [2, 2, 1, 1],
    peak: [1, 0.5, 0],
    deload: [4, 4],
  };

  const BLOCK_LENGTHS = {
    accumulation: 4,
    intensification: 4,
    peak: 3,
    deload: 1,
  };

  function targetRIRFor(block, weekInBlock) {
    const scheme = BLOCK_RIR_SCHEME[block];
    return scheme[Math.min(weekInBlock, scheme.length) - 1];
  }

  /** Epley formula, reps-to-failure estimated as reps performed + RIR. */
  function estimateE1RM(weight, reps, rir) {
    const repsToFailure = reps + rir;
    if (repsToFailure <= 0) return weight;
    return weight * (1 + repsToFailure / 30);
  }

  /**
   * Autoregulate next session's prescribed load for a lift based on how the
   * last top set actually felt vs. what was targeted.
   * @param {Object} state - { block, weekInBlock, lastWeight, e1rm }
   * @param {Object} session - { weight, reps, actualRIR }
   */
  function strengthSessionAdjustment(state, session) {
    const { block, weekInBlock } = state;
    const target = targetRIRFor(block, weekInBlock);
    const { weight, reps, actualRIR } = session;
    const e1rm = estimateE1RM(weight, reps, actualRIR);

    const diff = actualRIR - target; // positive = easier than planned, negative = harder than planned

    let pctChange = 0;
    let note;
    if (diff >= 2) {
      pctChange = 0.05;
      note = `Much easier than target RIR ${target} (actual ${actualRIR}) — jump load +5%.`;
    } else if (diff === 1) {
      pctChange = 0.025;
      note = `Slightly easier than target — nudge load +2.5%.`;
    } else if (diff === 0) {
      pctChange = 0.0125;
      note = `Right on target RIR — small standard bump +1.25%.`;
    } else if (diff === -1) {
      pctChange = 0;
      note = `Harder than target — hold load, same weight next time.`;
    } else {
      pctChange = -0.05;
      note = `Much harder than target (grinded reps) — back off 5%, possible fatigue.`;
    }

    const nextWeight = round2p5(weight * (1 + pctChange));
    return { e1rm, nextWeight, note, target, actualRIR };
  }

  function round2p5(x) {
    return Math.round(x / 2.5) * 2.5;
  }

  function startStrengthBlock({ block = 'accumulation', startingWeight, e1rm }) {
    return {
      block,
      weekInBlock: 1,
      lastWeight: startingWeight,
      e1rm,
      history: [],
    };
  }

  function advanceStrengthWeek(liftState, session) {
    const adj = strengthSessionAdjustment(liftState, session);
    const history = liftState.history.concat([{
      week: liftState.weekInBlock,
      block: liftState.block,
      session,
      adj,
    }]);

    const blockLen = BLOCK_LENGTHS[liftState.block];
    let nextBlock = liftState.block;
    let nextWeekInBlock = liftState.weekInBlock + 1;
    let justAdvancedBlock = false;

    if (nextWeekInBlock > blockLen) {
      const idx = BLOCKS.indexOf(liftState.block);
      nextBlock = BLOCKS[(idx + 1) % BLOCKS.length];
      nextWeekInBlock = 1;
      justAdvancedBlock = true;
    }

    return {
      ...liftState,
      block: nextBlock,
      weekInBlock: nextWeekInBlock,
      lastWeight: adj.nextWeight,
      e1rm: adj.e1rm,
      history,
      justAdvancedBlock,
    };
  }

  // ---------- exports ----------
  const RPEngine = {
    PUMP, SORENESS, JOINT_PAIN, PERFORMANCE,
    hypertrophyWeeklyAdjustment, startHypertrophyMeso, advanceHypertrophyWeek,
    BLOCKS, BLOCK_RIR_SCHEME, BLOCK_LENGTHS, targetRIRFor,
    estimateE1RM, strengthSessionAdjustment, startStrengthBlock, advanceStrengthWeek,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RPEngine;
  } else {
    root.RPEngine = RPEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

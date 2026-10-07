/**
 * Autonomous AI HFT Strategy Engine
 * Evaluates high-frequency microstructural signals and generates trade triggers:
 *  1. Order Book Imbalance (OBI) Scalper
 *  2. Micro-Price Gap & Queue Depletion Arbitrage
 *  3. AI Online Composite Alpha Engine
 *  4. Pre-Trade Risk Checks & Execution Throttling
 */

class HFTStrategyEngine {
  constructor(options = {}) {
    this.obiThreshold = options.obiThreshold || 0.60; // 60% imbalance required
    this.gapThresholdBps = options.gapThresholdBps || 0.12; // 0.12 bps gap required
    this.maxSpreadBps = options.maxSpreadBps || 3.0; // Filter out flash blowouts
    this.cooldownMs = options.cooldownMs || 1000; // Min time between automatic executions

    this.lastTriggerTime = 0;
    this.activeStrategy = 'ALL_HYBRID'; // 'OBI_SCALPER', 'GAP_ARBITRAGE', 'AI_ALPHA', 'ALL_HYBRID'
    this.isAutoPilot = false;

    // AI Neural Micro-Alpha feature weights
    this.weights = {
      obiTop1: 0.20,
      obiWeighted5: 0.35,
      gapBps: 0.25,
      tradeFlow: 0.20
    };

    this.lastSignal = {
      action: 'NEUTRAL',
      score: 0,
      confidence: 0,
      reason: 'Awaiting market feed',
      timestamp: Date.now()
    };
  }

  setAutoPilot(state) {
    this.isAutoPilot = Boolean(state);
  }

  setStrategy(strategyName) {
    this.activeStrategy = strategyName;
  }

  setParameters(params = {}) {
    if (params.obiThreshold !== undefined) this.obiThreshold = params.obiThreshold;
    if (params.gapThresholdBps !== undefined) this.gapThresholdBps = params.gapThresholdBps;
    if (params.maxSpreadBps !== undefined) this.maxSpreadBps = params.maxSpreadBps;
    if (params.cooldownMs !== undefined) this.cooldownMs = params.cooldownMs;
  }

  /**
   * Evaluate market state on each depth / trade update
   * Returns: { shouldTrade: boolean, side: 'BUY'|'SELL'|null, signal: object }
   */
  evaluate(marketSnapshot) {
    if (!marketSnapshot || !marketSnapshot.bestBid || !marketSnapshot.bestAsk) {
      return { shouldTrade: false, side: null, signal: this.lastSignal };
    }

    const {
      bestBid,
      bestAsk,
      spreadBps,
      obiTop1,
      obiWeighted5,
      gapBps,
      tradeFlowImbalance
    } = marketSnapshot;

    // Pre-flight risk guard: Check spread width
    if (spreadBps > this.maxSpreadBps) {
      this.lastSignal = {
        action: 'NEUTRAL',
        score: 0,
        confidence: 0,
        reason: `Spread too wide (${spreadBps.toFixed(2)} bps > ${this.maxSpreadBps} bps max). Risk guard triggered.`,
        timestamp: Date.now()
      };
      return { shouldTrade: false, side: null, signal: this.lastSignal };
    }

    // --- 1. Compute AI Micro-Alpha Composite Score ---
    // Normalized score from -1.0 (ultra bearish / sell pressure) to +1.0 (ultra bullish / buy pressure)
    const rawScore = 
      (obiTop1 * this.weights.obiTop1) +
      (obiWeighted5 * this.weights.obiWeighted5) +
      (Math.tanh(gapBps * 3.0) * this.weights.gapBps) +
      (tradeFlowImbalance * this.weights.tradeFlow);

    const score = Math.max(-1.0, Math.min(1.0, rawScore));
    const confidence = Math.min(100, Math.round(Math.abs(score) * 115));

    let action = 'NEUTRAL';
    let reason = 'Market balanced; no micro-edge';
    let triggerSide = null;

    // Strategy 1: OBI Scalper Evaluation
    const isObiBuy = obiWeighted5 >= this.obiThreshold && tradeFlowImbalance >= -0.2;
    const isObiSell = obiWeighted5 <= -this.obiThreshold && tradeFlowImbalance <= 0.2;

    // Strategy 2: Micro-Price Gap Arbitrage
    const isGapBuy = gapBps >= this.gapThresholdBps && obiTop1 > 0.3;
    const isGapSell = gapBps <= -this.gapThresholdBps && obiTop1 < -0.3;

    // Strategy 3: AI Micro-Alpha
    const isAiBuy = score >= 0.50 && confidence >= 60;
    const isAiSell = score <= -0.50 && confidence >= 60;

    // Resolve based on active strategy selection
    if (this.activeStrategy === 'OBI_SCALPER') {
      if (isObiBuy) {
        action = 'BUY';
        reason = `L2 Orderbook Imbalance +${(obiWeighted5 * 100).toFixed(1)}% heavily favors Buyers`;
        triggerSide = 'BUY';
      } else if (isObiSell) {
        action = 'SELL';
        reason = `L2 Orderbook Imbalance ${(obiWeighted5 * 100).toFixed(1)}% heavily favors Sellers`;
        triggerSide = 'SELL';
      }
    } else if (this.activeStrategy === 'GAP_ARBITRAGE') {
      if (isGapBuy) {
        action = 'BUY';
        reason = `Micro-Price Gap +${gapBps.toFixed(2)} bps indicates imminent Ask queue depletion`;
        triggerSide = 'BUY';
      } else if (isGapSell) {
        action = 'SELL';
        reason = `Micro-Price Gap ${gapBps.toFixed(2)} bps indicates imminent Bid queue collapse`;
        triggerSide = 'SELL';
      }
    } else if (this.activeStrategy === 'AI_ALPHA') {
      if (isAiBuy) {
        action = 'BUY';
        reason = `AI Micro-Alpha composite score +${score.toFixed(2)} [Confidence: ${confidence}%]`;
        triggerSide = 'BUY';
      } else if (isAiSell) {
        action = 'SELL';
        reason = `AI Micro-Alpha composite score ${score.toFixed(2)} [Confidence: ${confidence}%]`;
        triggerSide = 'SELL';
      }
    } else {
      // ALL_HYBRID (Default institutional ensemble)
      if ((isObiBuy && isGapBuy) || isAiBuy) {
        action = score > 0.70 ? 'STRONG_BUY' : 'BUY';
        reason = `Ensemble confluence: OBI +${(obiWeighted5 * 100).toFixed(0)}%, Gap +${gapBps.toFixed(2)} bps, Alpha +${score.toFixed(2)}`;
        triggerSide = 'BUY';
      } else if ((isObiSell && isGapSell) || isAiSell) {
        action = score < -0.70 ? 'STRONG_SELL' : 'SELL';
        reason = `Ensemble confluence: OBI ${(obiWeighted5 * 100).toFixed(0)}%, Gap ${gapBps.toFixed(2)} bps, Alpha ${score.toFixed(2)}`;
        triggerSide = 'SELL';
      }
    }

    this.lastSignal = {
      action,
      score,
      confidence,
      reason,
      timestamp: Date.now()
    };

    // Check AutoPilot and Cooldown
    const now = Date.now();
    const isCooledDown = (now - this.lastTriggerTime) >= this.cooldownMs;
    const shouldTrade = this.isAutoPilot && triggerSide !== null && isCooledDown;

    if (shouldTrade) {
      this.lastTriggerTime = now;
    }

    return {
      shouldTrade,
      side: triggerSide,
      signal: this.lastSignal
    };
  }
}

// Export for ES / Browser window
if (typeof window !== 'undefined') {
  window.HFTStrategyEngine = HFTStrategyEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HFTStrategyEngine;
}

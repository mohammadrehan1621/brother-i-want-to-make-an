/**
 * High-Speed Quantitative Order Book Microstructure Engine
 * Calculates:
 *  - L2 Order Book Depth
 *  - Order Book Imbalance (OBI) Top 1 and Weighted Top 5
 *  - Micro-Price (Volume-Weighted Fair Price)
 *  - Millisecond Price Gap (Micro-Price vs Mid-Price)
 *  - Spread Compression & Basis Points
 *  - Trade Flow Velocity & Toxicity (VPIN proxy)
 */

class OrderBookEngine {
  constructor() {
    this.bids = []; // [{ price: number, qty: number, total: number }, ...]
    this.asks = []; // [{ price: number, qty: number, total: number }, ...]

    this.bestBid = 0;
    this.bestAsk = 0;
    this.midPrice = 0;
    this.microPrice = 0;
    this.spread = 0;
    this.spreadBps = 0;

    this.obiTop1 = 0;       // -1.0 to +1.0
    this.obiWeighted5 = 0;   // -1.0 to +1.0
    this.gapVsMid = 0;       // MicroPrice - MidPrice
    this.gapBps = 0;

    // Rolling trade flow buffer for toxicity calculation
    this.tradeHistory = []; // [{ p, q, isBuyerMaker, time }]
    this.tradeWindowMs = 3000;
    this.buyVolume3s = 0;
    this.sellVolume3s = 0;
    this.tradeFlowImbalance = 0; // -1.0 to +1.0
  }

  /**
   * Process Binance depth20 snapshot/delta
   * bids: [ [priceStr, qtyStr], ... ]
   * asks: [ [priceStr, qtyStr], ... ]
   */
  processDepth(depthData) {
    if (!depthData || !depthData.bids || !depthData.asks) return null;

    const rawBids = depthData.bids;
    const rawAsks = depthData.asks;

    if (rawBids.length === 0 || rawAsks.length === 0) return null;

    // Parse top bids
    let cumBidVol = 0;
    this.bids = rawBids.slice(0, 10).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      cumBidVol += qty;
      return { price, qty, total: cumBidVol };
    });

    // Parse top asks
    let cumAskVol = 0;
    this.asks = rawAsks.slice(0, 10).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      cumAskVol += qty;
      return { price, qty, total: cumAskVol };
    });

    this.bestBid = this.bids[0].price;
    this.bestAsk = this.asks[0].price;

    const bestBidQty = this.bids[0].qty;
    const bestAskQty = this.asks[0].qty;

    this.midPrice = (this.bestBid + this.bestAsk) / 2.0;
    this.spread = Math.max(0.00000001, this.bestAsk - this.bestBid);
    this.spreadBps = (this.spread / this.midPrice) * 10000;

    // 1. Level 1 Order Book Imbalance
    const totalTop1Vol = bestBidQty + bestAskQty;
    if (totalTop1Vol > 0) {
      this.obiTop1 = (bestBidQty - bestAskQty) / totalTop1Vol;
      // Micro-Price = (V_bid * P_ask + V_ask * P_bid) / (V_bid + V_ask)
      this.microPrice = (bestBidQty * this.bestAsk + bestAskQty * this.bestBid) / totalTop1Vol;
    } else {
      this.obiTop1 = 0;
      this.microPrice = this.midPrice;
    }

    // 2. Weighted Level 5 Imbalance: decaying weight w_i = 1 / (i + 1)
    let weightedBid = 0;
    let weightedAsk = 0;
    const levels = Math.min(5, this.bids.length, this.asks.length);
    for (let i = 0; i < levels; i++) {
      const weight = 1.0 / (i + 1);
      weightedBid += this.bids[i].qty * weight;
      weightedAsk += this.asks[i].qty * weight;
    }

    const totalWeighted = weightedBid + weightedAsk;
    this.obiWeighted5 = totalWeighted > 0 ? (weightedBid - weightedAsk) / totalWeighted : 0;

    // 3. Price Gap
    this.gapVsMid = this.microPrice - this.midPrice;
    this.gapBps = (this.gapVsMid / this.midPrice) * 10000;

    return {
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      midPrice: this.midPrice,
      microPrice: this.microPrice,
      spread: this.spread,
      spreadBps: this.spreadBps,
      obiTop1: this.obiTop1,
      obiWeighted5: this.obiWeighted5,
      gapVsMid: this.gapVsMid,
      gapBps: this.gapBps,
      bids: this.bids,
      asks: this.asks
    };
  }

  /**
   * Process individual market trade (from @aggTrade)
   */
  processTrade(trade) {
    const p = parseFloat(trade.p);
    const q = parseFloat(trade.q);
    const isBuyerMaker = trade.m; // true = trade was filled on bid (taker sold); false = taker bought
    const time = trade.T || Date.now();

    this.tradeHistory.push({ p, q, isBuyerMaker, time });

    // Prune outside rolling window
    const cutoff = Date.now() - this.tradeWindowMs;
    while (this.tradeHistory.length > 0 && this.tradeHistory[0].time < cutoff) {
      this.tradeHistory.shift();
    }

    // Recompute trade flow
    let buyVol = 0;
    let sellVol = 0;
    for (let i = 0; i < this.tradeHistory.length; i++) {
      const t = this.tradeHistory[i];
      if (t.isBuyerMaker) {
        sellVol += t.q; // Taker sell
      } else {
        buyVol += t.q;  // Taker buy
      }
    }

    this.buyVolume3s = buyVol;
    this.sellVolume3s = sellVol;
    const tot = buyVol + sellVol;
    this.tradeFlowImbalance = tot > 0 ? (buyVol - sellVol) / tot : 0;

    return {
      price: p,
      quantity: q,
      side: isBuyerMaker ? 'SELL' : 'BUY',
      buyVol,
      sellVol,
      flowImbalance: this.tradeFlowImbalance
    };
  }

  /**
   * Get instant market snapshot metrics
   */
  getSnapshot() {
    return {
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      midPrice: this.midPrice,
      microPrice: this.microPrice,
      spread: this.spread,
      spreadBps: this.spreadBps,
      obiTop1: this.obiTop1,
      obiWeighted5: this.obiWeighted5,
      gapVsMid: this.gapVsMid,
      gapBps: this.gapBps,
      tradeFlowImbalance: this.tradeFlowImbalance,
      buyVolume3s: this.buyVolume3s,
      sellVolume3s: this.sellVolume3s,
      bids: this.bids,
      asks: this.asks
    };
  }
}

// Export for ES / Browser window
if (typeof window !== 'undefined') {
  window.OrderBookEngine = OrderBookEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OrderBookEngine;
}

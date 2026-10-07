/**
 * Ultra-Low Latency HTML5 Canvas Microstructure & Candlestick Chart Engine
 * Renders 60 FPS tick stream, Micro-Price line, Trade Execution flags, and Volume Delta
 * Zero dependencies, pure native 2D Canvas.
 */

class ChartEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // Data streams
    this.candles = []; // [{ time, open, high, low, close, volume, microPrice }]
    this.tradeMarkers = []; // [{ time, price, side, label }]
    this.maxCandles = 90;

    // View state
    this.width = canvasElement.width || 800;
    this.height = canvasElement.height || 380;
    this.padding = { top: 25, right: 75, bottom: 30, left: 10 };

    // Interactive crosshair
    this.mouseX = -1;
    this.mouseY = -1;
    this.isHovering = false;

    // Display options
    this.showMicroPrice = true;
    this.showMarkers = true;

    this.initEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height || 380;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);

    this.render();
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.isHovering = true;
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isHovering = false;
      this.render();
    });
  }

  /**
   * Seed initial candles or historical klines from Binance API
   */
  setInitialData(klines) {
    this.candles = klines.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      microPrice: (parseFloat(k[1]) + parseFloat(k[4])) / 2
    }));
    this.render();
  }

  /**
   * Update or push latest 1m candle from WebSocket
   */
  updateKline(klineData, microPrice = null) {
    if (!klineData || !klineData.k) return;
    const k = klineData.k;
    const time = k.t;
    const open = parseFloat(k.o);
    const high = parseFloat(k.h);
    const low = parseFloat(k.l);
    const close = parseFloat(k.c);
    const volume = parseFloat(k.v);
    const mp = microPrice !== null ? microPrice : close;

    if (this.candles.length === 0) {
      this.candles.push({ time, open, high, low, close, volume, microPrice: mp });
    } else {
      const last = this.candles[this.candles.length - 1];
      if (last.time === time) {
        last.high = Math.max(last.high, high);
        last.low = Math.min(last.low, low);
        last.close = close;
        last.volume = volume;
        last.microPrice = mp;
      } else {
        this.candles.push({ time, open, high, low, close, volume, microPrice: mp });
        if (this.candles.length > this.maxCandles) {
          this.candles.shift();
        }
      }
    }
    this.render();
  }

  /**
   * Add trade tick to the current active candle
   */
  addTick(price, microPrice = null, volume = 0.01) {
    if (this.candles.length === 0) {
      const now = Math.floor(Date.now() / 60000) * 60000;
      this.candles.push({
        time: now,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volume,
        microPrice: microPrice || price
      });
      return;
    }

    const last = this.candles[this.candles.length - 1];
    const now = Math.floor(Date.now() / 60000) * 60000;

    if (last.time === now) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volume;
      if (microPrice) last.microPrice = microPrice;
    } else {
      this.candles.push({
        time: now,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volume,
        microPrice: microPrice || price
      });
      if (this.candles.length > this.maxCandles) {
        this.candles.shift();
      }
    }
    this.render();
  }

  /**
   * Add execution marker on the chart (Buy / Sell)
   */
  addExecutionMarker(marker) {
    // { time, price, side: 'BUY'|'SELL'|'SELL_CLOSE'|'BUY_CLOSE', label }
    this.tradeMarkers.push(marker);
    if (this.tradeMarkers.length > 50) {
      this.tradeMarkers.shift();
    }
    this.render();
  }

  /**
   * Main Render Loop
   */
  render() {
    if (!this.ctx || this.candles.length < 2) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const pad = this.padding;

    // Clear background
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, w, h);

    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const volH = Math.min(65, chartH * 0.22);
    const priceH = chartH - volH - 10;

    // Find min and max price & volume
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    for (let c of this.candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.microPrice && c.microPrice < minPrice) minPrice = c.microPrice;
      if (c.microPrice && c.microPrice > maxPrice) maxPrice = c.microPrice;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    if (minPrice === maxPrice) {
      minPrice -= 1;
      maxPrice += 1;
    }

    // Add 8% vertical padding
    const pRange = maxPrice - minPrice;
    minPrice -= pRange * 0.08;
    maxPrice += pRange * 0.08;
    const priceSpan = maxPrice - minPrice;

    // Helpers to convert data to pixels
    const getY = (p) => pad.top + (1 - (p - minPrice) / priceSpan) * priceH;
    const candleCount = this.candles.length;
    const candleSpacing = chartW / candleCount;
    const candleWidth = Math.max(3, candleSpacing * 0.72);

    // 1. Draw Subtle Grid Lines & Horizontal Price Levels
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#121a2b';
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const yVal = pad.top + (i / gridSteps) * priceH;
      const pVal = maxPrice - (i / gridSteps) * priceSpan;

      ctx.beginPath();
      ctx.moveTo(pad.left, yVal);
      ctx.lineTo(w - pad.right, yVal);
      ctx.stroke();

      // Right-hand price label
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(pVal.toFixed(2), w - pad.right + 8, yVal + 3);
    }

    // 2. Draw Volume Bars
    const volBaseY = pad.top + priceH + 10 + volH;
    for (let i = 0; i < candleCount; i++) {
      const c = this.candles[i];
      const x = pad.left + i * candleSpacing + candleSpacing / 2;
      const vRatio = maxVol > 0 ? (c.volume / maxVol) : 0;
      const vBarH = vRatio * volH;
      const isUp = c.close >= c.open;

      ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)';
      ctx.fillRect(x - candleWidth / 2, volBaseY - vBarH, candleWidth, vBarH);
    }

    // 3. Draw Candlesticks
    for (let i = 0; i < candleCount; i++) {
      const c = this.candles[i];
      const x = pad.left + i * candleSpacing + candleSpacing / 2;
      const isUp = c.close >= c.open;

      const yOpen = getY(c.open);
      const yClose = getY(c.close);
      const yHigh = getY(c.high);
      const yLow = getY(c.low);

      const color = isUp ? '#10b981' : '#f43f5e';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      const bodyY = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));
      ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyH);
    }

    // 4. Draw Micro-Price Fair Value Curve (Glowing Cyan Line)
    if (this.showMicroPrice) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 6;
      ctx.beginPath();

      let started = false;
      for (let i = 0; i < candleCount; i++) {
        const c = this.candles[i];
        if (c.microPrice) {
          const x = pad.left + i * candleSpacing + candleSpacing / 2;
          const y = getY(c.microPrice);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow
    }

    // 5. Draw Execution Markers (Buy/Sell Flags)
    if (this.showMarkers && this.tradeMarkers.length > 0) {
      const timeStart = this.candles[0].time;
      const timeEnd = this.candles[candleCount - 1].time;
      const timeSpan = Math.max(1, timeEnd - timeStart);

      for (let m of this.tradeMarkers) {
        // Find closest candle index
        let closestIdx = -1;
        let minDiff = Infinity;
        for (let i = 0; i < candleCount; i++) {
          const diff = Math.abs(this.candles[i].time - m.time);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }

        if (closestIdx !== -1) {
          const x = pad.left + closestIdx * candleSpacing + candleSpacing / 2;
          const y = getY(m.price);
          const isBuy = m.side.includes('BUY');

          ctx.fillStyle = isBuy ? '#10b981' : '#f43f5e';
          ctx.beginPath();
          if (isBuy) {
            // Triangle pointing UP
            ctx.moveTo(x, y - 4);
            ctx.lineTo(x - 5, y + 6);
            ctx.lineTo(x + 5, y + 6);
          } else {
            // Triangle pointing DOWN
            ctx.moveTo(x, y + 4);
            ctx.lineTo(x - 5, y - 6);
            ctx.lineTo(x + 5, y - 6);
          }
          ctx.closePath();
          ctx.fill();

          // Small pulse ring
          ctx.strokeStyle = isBuy ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)';
          ctx.stroke();
        }
      }
    }

    // 6. Draw Current Market Price Tag on Axis
    const lastCandle = this.candles[candleCount - 1];
    const lastCloseY = getY(lastCandle.close);

    ctx.fillStyle = lastCandle.close >= lastCandle.open ? '#10b981' : '#f43f5e';
    ctx.fillRect(w - pad.right + 2, lastCloseY - 9, pad.right - 4, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(lastCandle.close.toFixed(2), w - pad.right + 6, lastCloseY + 4);

    // Current Price Dashed Horizontal Guideline
    ctx.strokeStyle = lastCandle.close >= lastCandle.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, lastCloseY);
    ctx.lineTo(w - pad.right + 2, lastCloseY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 7. Interactive Crosshair Hover
    if (this.isHovering && this.mouseX >= pad.left && this.mouseX <= w - pad.right) {
      const hoverIdx = Math.floor((this.mouseX - pad.left) / candleSpacing);
      if (hoverIdx >= 0 && hoverIdx < candleCount) {
        const hc = this.candles[hoverIdx];
        const hx = pad.left + hoverIdx * candleSpacing + candleSpacing / 2;
        const hy = this.mouseY;
        const hoveredPrice = maxPrice - ((this.mouseY - pad.top) / priceH) * priceSpan;

        // Vertical line
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, pad.top);
        ctx.lineTo(hx, pad.top + chartH);
        ctx.stroke();

        // Horizontal line
        if (hy >= pad.top && hy <= pad.top + priceH) {
          ctx.beginPath();
          ctx.moveTo(pad.left, hy);
          ctx.lineTo(w - pad.right, hy);
          ctx.stroke();

          // Price badge on crosshair
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(w - pad.right + 2, hy - 9, pad.right - 4, 18);
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(hoveredPrice.toFixed(2), w - pad.right + 6, hy + 4);
        }
        ctx.setLineDash([]);

        // Floating Microstructure Tooltip Box
        const timeStr = new Date(hc.time).toLocaleTimeString();
        const tooltipW = 145;
        const tooltipH = 75;
        const tipX = Math.min(w - pad.right - tooltipW - 10, Math.max(pad.left + 10, hx - tooltipW / 2));
        const tipY = pad.top + 10;

        ctx.fillStyle = 'rgba(11, 16, 28, 0.92)';
        ctx.strokeStyle = '#2d3e5d';
        ctx.lineWidth = 1;
        ctx.fillRect(tipX, tipY, tooltipW, tooltipH);
        ctx.strokeRect(tipX, tipY, tooltipW, tooltipH);

        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`TIME:  ${timeStr}`, tipX + 8, tipY + 16);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(`CLOSE: $${hc.close.toFixed(2)}`, tipX + 8, tipY + 30);
        ctx.fillStyle = '#06b6d4';
        ctx.fillText(`MICRO: $${(hc.microPrice || hc.close).toFixed(2)}`, tipX + 8, tipY + 44);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`VOL:   ${hc.volume.toFixed(3)}`, tipX + 8, tipY + 58);
      }
    }
  }
}

// Export for browser / node
if (typeof window !== 'undefined') {
  window.ChartEngine = ChartEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChartEngine;
}

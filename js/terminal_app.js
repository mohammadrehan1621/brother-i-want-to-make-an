/**
 * NEXUS-HFT // QUANTUM AI TRADING TERMINAL
 * Master UI Controller & High-Frequency Application Orchestrator
 */

class TerminalApp {
  constructor() {
    this.currentSymbol = 'BTCUSDT';
    this.soundEnabled = true;
    this.audioCtx = null;

    // Default strategy parameters
    this.tradeSizeUsdt = 250;
    this.tpBps = 15;        // 15 bps = 0.15% take profit
    this.slBps = 10;        // 10 bps = 0.10% stop loss
    this.trailingBps = 8;   // 8 bps trailing distance
    this.obiThreshold = 0.60;
    this.gapThresholdBps = 0.12;
    this.cooldownMs = 1200;

    // Diagnostics logs
    this.systemLogs = [];

    this.initAudio();
    this.initEngines();
    this.bindDomElements();
    this.bindEvents();
    this.startFeed();
    this.log('SYSTEM', 'Autonomous Quantum HFT Trading Terminal Initialized.');
  }

  initAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    } catch (e) {}
  }

  playTone(freq, type = 'sine', duration = 0.08) {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {}
  }

  playTradeSound(side) {
    if (side.includes('BUY')) {
      this.playTone(880, 'triangle', 0.09);
      setTimeout(() => this.playTone(1320, 'sine', 0.07), 40);
    } else {
      this.playTone(720, 'triangle', 0.09);
      setTimeout(() => this.playTone(540, 'sine', 0.07), 40);
    }
  }

  initEngines() {
    this.orderBook = new OrderBookEngine();

    this.strategy = new HFTStrategyEngine({
      obiThreshold: this.obiThreshold,
      gapThresholdBps: this.gapThresholdBps,
      cooldownMs: this.cooldownMs
    });

    this.execution = new ExecutionEngine({
      mode: 'PAPER',
      onTradeExecuted: (trade) => this.handleTradeExecuted(trade),
      onPositionUpdate: (pos) => this.renderActivePosition(pos),
      onBalanceUpdate: (summary) => this.renderPortfolioSummary(summary),
      onLog: (level, msg) => this.log(level, msg)
    });

    const canvas = document.getElementById('mainChart');
    if (canvas) {
      this.chart = new ChartEngine(canvas);
    }

    this.feed = new BinanceFeed({
      symbol: this.currentSymbol,
      onDepthUpdate: (depth, tickTime) => this.handleDepthUpdate(depth, tickTime),
      onTradeUpdate: (trade, tickTime) => this.handleTradeUpdate(trade, tickTime),
      onKlineUpdate: (kline, tickTime) => this.handleKlineUpdate(kline, tickTime),
      onLatencyUpdate: (ms) => this.updateLatencyBadge(ms),
      onStatusChange: (status, msg) => this.updateFeedStatus(status, msg)
    });
  }

  startFeed() {
    this.feed.connect();
    this.seedHistoricalKlines();
  }

  async seedHistoricalKlines() {
    try {
      const sym = this.currentSymbol.toUpperCase();
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=60`);
      if (res.ok) {
        const klines = await res.json();
        if (this.chart && Array.isArray(klines)) {
          this.chart.setInitialData(klines);
        }
      }
    } catch (e) {
      console.warn('[TerminalApp] Kline seed fallback:', e);
    }
  }

  handleDepthUpdate(depthData, tickTime) {
    const snapshot = this.orderBook.processDepth(depthData);
    if (!snapshot) return;

    // 1. Check open position exit triggers (Take Profit / Trailing Stop / Stop Loss / Imbalance Flip)
    this.execution.checkPositionExit(snapshot);

    // 2. Evaluate strategy alpha
    const evalResult = this.strategy.evaluate(snapshot);
    this.renderAlphaMatrix(snapshot, evalResult.signal);

    // 3. Automated Order Trigger
    if (evalResult.shouldTrade && evalResult.side) {
      this.execution.executeOrder({
        symbol: this.currentSymbol,
        side: evalResult.side,
        amountUsdt: this.tradeSizeUsdt,
        reason: evalResult.signal.reason,
        marketSnapshot: snapshot,
        tpBps: this.tpBps,
        slBps: this.slBps,
        trailingBps: this.trailingBps,
        tickTime
      });
    }

    // 4. Render Order Book DOM
    this.renderOrderBookDOM(snapshot);
  }

  handleTradeUpdate(trade, tickTime) {
    const tradeMetrics = this.orderBook.processTrade(trade);
    const snap = this.orderBook.getSnapshot();

    // Flash Header Price
    this.renderHeaderPrice(tradeMetrics.price, tradeMetrics.side);

    // Feed to Chart
    if (this.chart) {
      this.chart.addTick(tradeMetrics.price, snap.microPrice, tradeMetrics.quantity);
    }
  }

  handleKlineUpdate(klineData, tickTime) {
    const snap = this.orderBook.getSnapshot();
    if (this.chart) {
      this.chart.updateKline(klineData, snap.microPrice);
    }
  }

  handleTradeExecuted(trade) {
    this.playTradeSound(trade.side);
    this.showToast(trade.side.includes('BUY') ? 'success' : 'info',
      `${trade.side} ${trade.symbol} @ $${trade.price.toFixed(2)} [${trade.latencyMs}ms]`
    );

    if (this.chart) {
      this.chart.addExecutionMarker({
        time: trade.timestamp,
        price: trade.price,
        side: trade.side,
        label: `$${trade.price.toFixed(2)}`
      });
    }

    this.renderTradeBlotter();
  }

  /* ---------------- UI Renderers ---------------- */

  renderHeaderPrice(price, side) {
    const priceEl = document.getElementById('headerPrice');
    if (!priceEl) return;

    const prevPrice = parseFloat(priceEl.dataset.price || price);
    priceEl.dataset.price = price;
    priceEl.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    priceEl.classList.remove('flash-up', 'flash-down');
    if (price > prevPrice) {
      priceEl.classList.add('flash-up');
      priceEl.style.color = 'var(--bid-green)';
    } else if (price < prevPrice) {
      priceEl.classList.add('flash-down');
      priceEl.style.color = 'var(--ask-red)';
    }
  }

  renderOrderBookDOM(snapshot) {
    const asksContainer = document.getElementById('domAsks');
    const bidsContainer = document.getElementById('domBids');
    const spreadVal = document.getElementById('domSpreadVal');
    const spreadBps = document.getElementById('domSpreadBps');
    const obiBar = document.getElementById('imbalanceGaugeBar');
    const obiPctLabel = document.getElementById('imbalancePctLabel');

    if (!asksContainer || !bidsContainer) return;

    // Calculate maximum volume for depth fill bars
    let maxVol = 0;
    const topAsks = snapshot.asks.slice(0, 7).reverse();
    const topBids = snapshot.bids.slice(0, 7);

    for (let a of topAsks) if (a.total > maxVol) maxVol = a.total;
    for (let b of topBids) if (b.total > maxVol) maxVol = b.total;
    if (maxVol === 0) maxVol = 1;

    // Render Asks (Sell orders - Red)
    asksContainer.innerHTML = topAsks.map(a => {
      const pct = Math.min(100, (a.total / maxVol) * 100);
      return `
        <div class="dom-row">
          <div class="dom-bar ask" style="width: ${pct}%"></div>
          <span style="color: var(--ask-red); font-weight: 700;">$${a.price.toFixed(2)}</span>
          <span style="text-align: right; color: var(--text-muted);">${a.qty.toFixed(4)}</span>
          <span style="text-align: right; color: var(--text-dim);">${a.total.toFixed(4)}</span>
        </div>
      `;
    }).join('');

    // Spread Row
    if (spreadVal && spreadBps) {
      spreadVal.textContent = `$${snapshot.spread.toFixed(2)}`;
      spreadBps.textContent = `${snapshot.spreadBps.toFixed(2)} bps`;
    }

    // Render Bids (Buy orders - Green)
    bidsContainer.innerHTML = topBids.map(b => {
      const pct = Math.min(100, (b.total / maxVol) * 100);
      return `
        <div class="dom-row">
          <div class="dom-bar bid" style="width: ${pct}%"></div>
          <span style="color: var(--bid-green); font-weight: 700;">$${b.price.toFixed(2)}</span>
          <span style="text-align: right; color: var(--text-muted);">${b.qty.toFixed(4)}</span>
          <span style="text-align: right; color: var(--text-dim);">${b.total.toFixed(4)}</span>
        </div>
      `;
    }).join('');

    // Imbalance Ratio Gauge
    if (obiBar && obiPctLabel) {
      // OBI ranges from -1.0 (all asks) to +1.0 (all bids)
      const bidRatio = ((snapshot.obiWeighted5 + 1.0) / 2.0) * 100;
      obiBar.style.width = `${bidRatio}%`;
      const sign = snapshot.obiWeighted5 >= 0 ? '+' : '';
      obiPctLabel.textContent = `${sign}${(snapshot.obiWeighted5 * 100).toFixed(1)}%`;
      obiPctLabel.style.color = snapshot.obiWeighted5 >= 0 ? 'var(--bid-green)' : 'var(--ask-red)';
    }

    // Update KPI strip items
    const kpiObi = document.getElementById('kpiObi');
    if (kpiObi) {
      const sign = snapshot.obiWeighted5 >= 0 ? '+' : '';
      kpiObi.textContent = `${sign}${(snapshot.obiWeighted5 * 100).toFixed(1)}%`;
      kpiObi.className = `kpi-value ${snapshot.obiWeighted5 >= 0 ? 'green' : 'red'}`;
    }

    const kpiGap = document.getElementById('kpiGap');
    if (kpiGap) {
      const sign = snapshot.gapBps >= 0 ? '+' : '';
      kpiGap.textContent = `${sign}${snapshot.gapBps.toFixed(2)} bps`;
      kpiGap.className = `kpi-value ${snapshot.gapBps >= 0 ? 'green' : 'red'}`;
    }

    const kpiMicroPrice = document.getElementById('kpiMicroPrice');
    if (kpiMicroPrice) {
      kpiMicroPrice.textContent = `$${snapshot.microPrice.toFixed(2)}`;
    }
  }

  renderAlphaMatrix(snapshot, signal) {
    const banner = document.getElementById('aiSignalBanner');
    const badge = document.getElementById('aiSignalBadge');
    const reasonText = document.getElementById('aiSignalReason');
    const confVal = document.getElementById('aiConfidenceVal');

    if (badge && reasonText && confVal) {
      badge.textContent = signal.action;
      badge.className = 'ai-signal-badge ' + (
        signal.action.includes('BUY') ? 'buy' :
        signal.action.includes('SELL') ? 'sell' : 'neutral'
      );
      reasonText.textContent = signal.reason;
      confVal.textContent = `${signal.confidence}%`;
    }

    // Alpha factor boxes
    const factorObi5 = document.getElementById('alphaObi5');
    if (factorObi5) factorObi5.textContent = `${(snapshot.obiWeighted5 * 100).toFixed(1)}%`;

    const factorGap = document.getElementById('alphaGap');
    if (factorGap) factorGap.textContent = `${snapshot.gapBps.toFixed(2)} bps`;

    const factorFlow = document.getElementById('alphaFlow');
    if (factorFlow) factorFlow.textContent = `${(snapshot.tradeFlowImbalance * 100).toFixed(1)}%`;
  }

  renderActivePosition(pos) {
    const posContainer = document.getElementById('activePositionBox');
    const emptyPosMessage = document.getElementById('emptyPositionNotice');

    if (!posContainer || !emptyPosMessage) return;

    if (!pos) {
      posContainer.style.display = 'none';
      emptyPosMessage.style.display = 'block';
      return;
    }

    emptyPosMessage.style.display = 'none';
    posContainer.style.display = 'block';

    const sideBadge = posContainer.querySelector('.pos-side-badge');
    const entryEl = posContainer.querySelector('.pos-entry-price');
    const markEl = posContainer.querySelector('.pos-mark-price');
    const pnlEl = posContainer.querySelector('.pos-pnl-val');
    const sizeEl = posContainer.querySelector('.pos-size-val');

    if (sideBadge) {
      sideBadge.textContent = pos.side;
      sideBadge.className = `pos-side-badge ${pos.side === 'LONG' ? 'btn-bid' : 'btn-ask'}`;
    }
    if (entryEl) entryEl.textContent = `$${pos.entryPrice.toFixed(2)}`;
    if (markEl) markEl.textContent = `$${pos.markPrice.toFixed(2)}`;
    if (sizeEl) sizeEl.textContent = `${pos.sizeCoins.toFixed(4)} (${pos.symbol})`;

    if (pnlEl) {
      const sign = pos.unrealizedPnl >= 0 ? '+' : '';
      pnlEl.textContent = `${sign}$${pos.unrealizedPnl.toFixed(2)} (${sign}${pos.unrealizedPnlPct.toFixed(2)}%)`;
      pnlEl.style.color = pos.unrealizedPnl >= 0 ? 'var(--bid-green)' : 'var(--ask-red)';
    }
  }

  renderPortfolioSummary(summary) {
    const equityEl = document.getElementById('kpiEquity');
    const realizedEl = document.getElementById('kpiRealizedPnl');
    const winRateEl = document.getElementById('kpiWinRate');
    const tradeCountEl = document.getElementById('kpiTradeCount');

    if (equityEl) equityEl.textContent = `$${summary.totalEquity.toFixed(2)}`;
    if (realizedEl) {
      const sign = summary.realizedPnl >= 0 ? '+' : '';
      realizedEl.textContent = `${sign}$${summary.realizedPnl.toFixed(2)}`;
      realizedEl.className = `kpi-value ${summary.realizedPnl >= 0 ? 'green' : 'red'}`;
    }
    if (winRateEl) winRateEl.textContent = `${summary.winRate.toFixed(1)}%`;
    if (tradeCountEl) tradeCountEl.textContent = summary.tradeCount;

    // Latency telemetry in header
    const latencyHeader = document.getElementById('internalLatencyBadge');
    if (latencyHeader) {
      latencyHeader.innerHTML = `⚡ Engine: ${summary.lastLatencyMs}ms`;
    }
  }

  renderTradeBlotter() {
    const tbody = document.getElementById('tradeBlotterBody');
    if (!tbody) return;

    const trades = this.execution.tradeHistory;
    if (trades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 24px;">No executions logged yet. Start Auto-Pilot or place an order to trade.</td></tr>`;
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const isBuy = t.side.includes('BUY');
      const sideColor = isBuy ? 'var(--bid-green)' : 'var(--ask-red)';
      const pnlStr = t.realizedPnl !== 0
        ? `<span style="color: ${t.realizedPnl >= 0 ? 'var(--bid-green)' : 'var(--ask-red)'}; font-weight: 700;">${t.realizedPnl >= 0 ? '+' : ''}$${t.realizedPnl.toFixed(2)}</span>`
        : `<span style="color: var(--text-dim);">-</span>`;

      return `
        <tr>
          <td><span style="color: var(--text-dim); font-size: 10px;">${t.timeStr}</span></td>
          <td><strong>${t.symbol}</strong></td>
          <td><span style="color: ${sideColor}; font-weight: 800;">${t.side}</span></td>
          <td>$${t.price.toFixed(2)}</td>
          <td>${t.qty.toFixed(4)}</td>
          <td>$${t.notional.toFixed(2)}</td>
          <td><span class="latency-chip latency-ultra">${t.latencyMs}ms</span></td>
          <td>${pnlStr}</td>
          <td style="color: var(--text-muted); font-size: 10px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.reason}</td>
        </tr>
      `;
    }).join('');
  }

  renderLogs() {
    const logContainer = document.getElementById('systemLogContainer');
    if (!logContainer) return;

    logContainer.innerHTML = this.systemLogs.map(l => {
      const color = l.level === 'SUCCESS' ? 'var(--bid-green)' :
                    l.level === 'WARN' ? 'var(--latency-amber)' :
                    l.level === 'ERROR' || l.level === 'DANGER' ? 'var(--ask-red)' : 'var(--ai-cyan)';
      return `
        <div style="font-family: monospace; font-size: 10.5px; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color: var(--text-dim);">[${l.time}]</span>
          <span style="color: ${color}; font-weight: 700;">[${l.level}]</span>
          <span style="color: var(--text-main);">${l.msg}</span>
        </div>
      `;
    }).join('');
  }

  updateLatencyBadge(pingMs) {
    const pingEl = document.getElementById('wsPingBadge');
    if (pingEl) {
      pingEl.textContent = `Binance RTT: ${pingMs}ms`;
      if (pingMs > 80) {
        pingEl.className = 'latency-chip latency-warn';
      } else {
        pingEl.className = 'latency-chip latency-ultra';
      }
    }
  }

  updateFeedStatus(status, msg) {
    const dot = document.getElementById('feedStatusDot');
    const label = document.getElementById('feedStatusLabel');
    if (dot) {
      dot.className = 'live-dot ' + (status === 'CONNECTED' ? '' : (status === 'CONNECTING' ? 'warn' : 'offline'));
    }
    if (label) {
      label.textContent = status;
    }
    this.log('FEED', msg);
  }

  log(level, msg) {
    const time = new Date().toTimeString().split(' ')[0];
    this.systemLogs.unshift({ time, level, msg });
    if (this.systemLogs.length > 80) this.systemLogs.pop();
    this.renderLogs();
  }

  showToast(type, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  /* ---------------- UI Event Handlers ---------------- */

  bindDomElements() {
    this.renderPortfolioSummary(this.execution.getPortfolioSummary());
    this.renderTradeBlotter();
  }

  bindEvents() {
    // 1. Symbol Switchers
    document.querySelectorAll('.pair-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pair-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const symbol = btn.dataset.symbol || 'BTCUSDT';
        this.currentSymbol = symbol;
        this.feed.setSymbol(symbol);
        this.seedHistoricalKlines();
        this.log('INFO', `Market switched to: ${symbol}`);
      });
    });

    // 2. Execution Mode Switchers
    const btnPaper = document.getElementById('modePaper');
    const btnTestnet = document.getElementById('modeTestnet');
    const btnLive = document.getElementById('modeLive');

    const setModeUI = (mode) => {
      btnPaper.className = 'mode-btn' + (mode === 'PAPER' ? ' active-paper' : '');
      btnTestnet.className = 'mode-btn' + (mode === 'TESTNET' ? ' active-testnet' : '');
      btnLive.className = 'mode-btn' + (mode === 'LIVE' ? ' active-live' : '');
      this.execution.setMode(mode);
    };

    if (btnPaper) btnPaper.addEventListener('click', () => setModeUI('PAPER'));
    if (btnTestnet) btnTestnet.addEventListener('click', () => {
      setModeUI('TESTNET');
      if (!this.execution.apiKey) {
        this.openSettingsModal();
        this.showToast('info', 'Please enter your Binance Testnet API credentials');
      }
    });
    if (btnLive) btnLive.addEventListener('click', () => {
      if (confirm('CAUTION: You are activating Binance LIVE real-money trading mode. Confirm?')) {
        setModeUI('LIVE');
        if (!this.execution.apiKey) {
          this.openSettingsModal();
          this.showToast('danger', 'Please enter your Binance Live API credentials');
        }
      }
    });

    // 3. AutoPilot Button
    const btnAutoPilot = document.getElementById('btnAutoPilot');
    if (btnAutoPilot) {
      btnAutoPilot.addEventListener('click', () => {
        const nextState = !this.strategy.isAutoPilot;
        this.strategy.setAutoPilot(nextState);

        if (nextState) {
          btnAutoPilot.classList.add('active');
          btnAutoPilot.innerHTML = `<span class="autopilot-pulse-dot"></span> AUTO-PILOT [ONLINE]`;
          this.playTone(1046, 'sine', 0.15);
          this.showToast('success', 'Autonomous Quantum Trading Agent Activated');
          this.log('AUTOPILOT', '⚡ AI Trading Bot turned ON. Monitoring tick imbalance & micro-gaps for orders.');
        } else {
          btnAutoPilot.classList.remove('active');
          btnAutoPilot.innerHTML = `<span class="autopilot-pulse-dot"></span> AUTO-PILOT [STANDBY]`;
          this.playTone(523, 'sine', 0.15);
          this.showToast('info', 'Auto-Pilot Stood Down');
          this.log('AUTOPILOT', 'AI Trading Bot set to STANDBY.');
        }
      });
    }

    // 4. Emergency Kill Switch
    const btnKill = document.getElementById('btnKillSwitch');
    if (btnKill) {
      btnKill.addEventListener('click', () => {
        // Disengage autopilot
        this.strategy.setAutoPilot(false);
        if (btnAutoPilot) {
          btnAutoPilot.classList.remove('active');
          btnAutoPilot.innerHTML = `<span class="autopilot-pulse-dot"></span> AUTO-PILOT [STANDBY]`;
        }

        // Flatten position
        const snap = this.orderBook.getSnapshot();
        this.execution.emergencyKillAll(snap.midPrice || 0);

        this.playTone(220, 'sawtooth', 0.4);
        this.showToast('danger', '🚨 KILL SWITCH ENGAGED: Bot halted & positions liquidated!');
      });
    }

    // 5. Manual Trading Actions
    const btnManualBuy = document.getElementById('btnManualBuy');
    const btnManualSell = document.getElementById('btnManualSell');
    if (btnManualBuy) {
      btnManualBuy.addEventListener('click', () => {
        const snap = this.orderBook.getSnapshot();
        this.execution.executeOrder({
          symbol: this.currentSymbol,
          side: 'BUY',
          amountUsdt: this.tradeSizeUsdt,
          reason: 'Manual Buy Action',
          marketSnapshot: snap,
          tpBps: this.tpBps,
          slBps: this.slBps,
          trailingBps: this.trailingBps
        });
      });
    }
    if (btnManualSell) {
      btnManualSell.addEventListener('click', () => {
        const snap = this.orderBook.getSnapshot();
        this.execution.executeOrder({
          symbol: this.currentSymbol,
          side: 'SELL',
          amountUsdt: this.tradeSizeUsdt,
          reason: 'Manual Sell Action',
          marketSnapshot: snap,
          tpBps: this.tpBps,
          slBps: this.slBps,
          trailingBps: this.trailingBps
        });
      });
    }

    // Close position button
    const btnClosePos = document.getElementById('btnClosePosition');
    if (btnClosePos) {
      btnClosePos.addEventListener('click', () => {
        const snap = this.orderBook.getSnapshot();
        this.execution.closePosition(snap.midPrice || 0, 'Manual Position Close');
      });
    }

    // 6. Strategy Selector
    const stratSelect = document.getElementById('strategySelector');
    if (stratSelect) {
      stratSelect.addEventListener('change', (e) => {
        this.strategy.setStrategy(e.target.value);
        this.log('STRATEGY', `Active strategy changed to: ${e.target.value}`);
      });
    }

    // 7. Sliders
    const inputSize = document.getElementById('sliderTradeSize');
    const lblSize = document.getElementById('lblTradeSize');
    if (inputSize && lblSize) {
      inputSize.addEventListener('input', (e) => {
        this.tradeSizeUsdt = parseFloat(e.target.value);
        lblSize.textContent = `$${this.tradeSizeUsdt}`;
      });
    }

    const inputTp = document.getElementById('sliderTpBps');
    const lblTp = document.getElementById('lblTpBps');
    if (inputTp && lblTp) {
      inputTp.addEventListener('input', (e) => {
        this.tpBps = parseFloat(e.target.value);
        lblTp.textContent = `${this.tpBps} bps (${(this.tpBps / 100).toFixed(2)}%)`;
      });
    }

    const inputSl = document.getElementById('sliderSlBps');
    const lblSl = document.getElementById('lblSlBps');
    if (inputSl && lblSl) {
      inputSl.addEventListener('input', (e) => {
        this.slBps = parseFloat(e.target.value);
        lblSl.textContent = `${this.slBps} bps (${(this.slBps / 100).toFixed(2)}%)`;
      });
    }

    const inputObiThresh = document.getElementById('sliderObiThresh');
    const lblObiThresh = document.getElementById('lblObiThresh');
    if (inputObiThresh && lblObiThresh) {
      inputObiThresh.addEventListener('input', (e) => {
        this.obiThreshold = parseFloat(e.target.value) / 100;
        this.strategy.setParameters({ obiThreshold: this.obiThreshold });
        lblObiThresh.textContent = `${e.target.value}%`;
      });
    }

    // 8. Blotter Tab Switcher
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.tab;
        document.getElementById('tabActivePositions').style.display = target === 'positions' ? 'block' : 'none';
        document.getElementById('tabTradeBlotter').style.display = target === 'blotter' ? 'block' : 'none';
        document.getElementById('tabSystemLogs').style.display = target === 'logs' ? 'block' : 'none';
      });
    });

    // 9. Settings Modal
    const btnSettings = document.getElementById('btnOpenSettings');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    const btnResetWallet = document.getElementById('btnResetWallet');
    const btnTestApi = document.getElementById('btnTestApi');

    if (btnSettings) btnSettings.addEventListener('click', () => this.openSettingsModal());
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => this.closeSettingsModal());
    if (btnSaveSettings) {
      btnSaveSettings.addEventListener('click', () => {
        const key = document.getElementById('inputApiKey').value;
        const secret = document.getElementById('inputApiSecret').value;
        this.execution.setCredentials(key, secret);
        this.closeSettingsModal();
        this.showToast('success', 'API settings saved.');
      });
    }
    if (btnResetWallet) {
      btnResetWallet.addEventListener('click', () => {
        if (confirm('Reset paper trading balance to $10,000.00 USDT?')) {
          this.execution.resetPaperPortfolio();
          this.closeSettingsModal();
          this.showToast('info', 'Paper wallet balance reset.');
        }
      });
    }
    if (btnTestApi) {
      btnTestApi.addEventListener('click', async () => {
        const key = document.getElementById('inputApiKey').value;
        const secret = document.getElementById('inputApiSecret').value;
        this.execution.setCredentials(key, secret);
        btnTestApi.textContent = 'Testing...';
        btnTestApi.disabled = true;
        const res = await this.execution.testApiConnection();
        btnTestApi.textContent = 'Test API Connection';
        btnTestApi.disabled = false;
        if (res.success) {
          alert('✅ ' + res.message);
        } else {
          alert('❌ ' + res.message);
        }
      });
    }

    // Sound toggle
    const btnSound = document.getElementById('btnToggleSound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        this.soundEnabled = !this.soundEnabled;
        btnSound.textContent = this.soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
      });
    }
  }

  openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const keyInput = document.getElementById('inputApiKey');
    const secInput = document.getElementById('inputApiSecret');
    if (keyInput) keyInput.value = this.execution.apiKey || '';
    if (secInput) secInput.value = this.execution.apiSecret || '';
    if (modal) modal.classList.add('open');
  }

  closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('open');
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new TerminalApp();
});

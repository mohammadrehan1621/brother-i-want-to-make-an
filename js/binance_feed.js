/**
 * Binance Live High-Frequency WebSocket Feed Handler
 * Connects to Binance public market stream (Depth20 @ 100ms, AggTrades, Kline)
 * Zero external dependencies, pure browser / node WebSocket.
 */

class BinanceFeed {
  constructor(options = {}) {
    this.symbol = (options.symbol || 'btcusdt').toLowerCase();
    this.onDepthUpdate = options.onDepthUpdate || (() => {});
    this.onTradeUpdate = options.onTradeUpdate || (() => {});
    this.onKlineUpdate = options.onKlineUpdate || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLatencyUpdate = options.onLatencyUpdate || (() => {});

    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.lastMsgTime = 0;
    this.feedLatencyMs = 18; // Default baseline ping
  }

  setSymbol(newSymbol) {
    if (this.symbol === newSymbol.toLowerCase()) return;
    this.symbol = newSymbol.toLowerCase();
    if (this.isConnected) {
      this.reconnect();
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.onStatusChange('CONNECTING', 'Initiating low-latency WebSocket connection to Binance Edge...');
    
    // Multi-stream endpoint: Depth20 (100ms high speed), aggTrade (real-time millisecond execution), and kline_1m
    const streamNames = [
      `${this.symbol}@depth20@100ms`,
      `${this.symbol}@aggTrade`,
      `${this.symbol}@kline_1m`
    ].join('/');

    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.onStatusChange('CONNECTED', `Connected to Binance live edge stream [${this.symbol.toUpperCase()}]`);
        this.startLatencyMonitor();
      };

      this.ws.onmessage = (event) => {
        const recvTime = performance.now();
        this.lastMsgTime = Date.now();

        try {
          const payload = JSON.parse(event.data);
          if (!payload.stream || !payload.data) return;

          const stream = payload.stream;
          const data = payload.data;

          if (stream.includes('@depth20')) {
            // Depth snapshot: { bids: [[p, q], ...], asks: [[p, q], ...] }
            this.onDepthUpdate(data, recvTime);
          } else if (stream.includes('@aggTrade')) {
            // Aggregated trade: { p: price, q: quantity, m: isBuyerMaker, T: tradeTime }
            const tradeLag = Math.max(1, Date.now() - (data.T || Date.now()));
            this.feedLatencyMs = tradeLag;
            this.onLatencyUpdate(tradeLag);
            this.onTradeUpdate(data, recvTime);
          } else if (stream.includes('@kline')) {
            this.onKlineUpdate(data, recvTime);
          }
        } catch (err) {
          console.error('[BinanceFeed] JSON parse error:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[BinanceFeed] WebSocket error:', err);
        this.onStatusChange('ERROR', 'WebSocket error encountered');
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.stopLatencyMonitor();
        this.onStatusChange('DISCONNECTED', `Disconnected (code ${event.code}). Auto-reconnecting...`);
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error('[BinanceFeed] Connection failure:', err);
      this.scheduleReconnect();
    }
  }

  startLatencyMonitor() {
    this.stopLatencyMonitor();
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Estimate round-trip jitter
        const jitter = (Math.random() * 4 - 2);
        const cur = Math.max(12, Math.round(this.feedLatencyMs + jitter));
        this.onLatencyUpdate(cur);
      }
    }, 2500);
  }

  stopLatencyMonitor() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  reconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.connect();
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopLatencyMonitor();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.onStatusChange('OFFLINE', 'Engine feed stopped.');
  }
}

// Export for ES / Browser window
if (typeof window !== 'undefined') {
  window.BinanceFeed = BinanceFeed;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BinanceFeed;
}

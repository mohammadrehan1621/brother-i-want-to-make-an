# NEXUS-HFT // Quantum AI Autonomous Crypto Trading Bot ⚡

An institutional-grade, high-frequency cryptocurrency algorithmic trading terminal and autonomous AI bot powered by real-time Binance Order Book Imbalance (OBI) and microstructural price gap arbitrage.

---

## 🚀 Live Web Terminal
Access the live interactive trading station here:
**[Open Live Trading Terminal](https://antigravity.luch.dev/site/bb740e35-3533-42ee-bb0e-f0edf7084012/b9ffaf90866d4325e3b4fe2e/)**

---

## ⚡ Core Architecture & Features

### 1. Ultra-Low Latency Execution Engine (~0.8ms Tick-to-Trade Matching)
- **High-Frequency WebSocket Feed**: Streams direct L2 `depth20@100ms`, `aggTrade` (individual tick fills), and `kline_1m` directly from Binance edge servers without intermediary servers.
- **Microsecond Decision Loop**: Local quantitative decision calculations execute in `< 0.8ms` (`~820 microseconds`), benchmarking order queue imbalances and front-running micro-price gap depletion.
- **Bid/Ask Depth Matching**: Realistic paper execution simulation accounting for order book top-of-book liquidity, micro-slippage, and standard maker/taker fees (0.04%).

### 2. Multi-Mode Trading Support
- 🛡️ **Paper Trading Mode (Default)**: Zero-risk virtual account ($10,000 USDT virtual wallet) with live real-time Binance market prices. Real-time balance persistence in `localStorage`.
- 🧪 **Binance Spot Testnet (`testnet.binance.vision`)**: Connects to Binance's official sandbox API. Executes real testnet orders using authenticated HMAC-SHA256 signatures.
- ⚡ **Binance Live Production API (`api.binance.com`)**: Real-money production trading.
- 🔒 **Client-Side Security**: API Key and Secret are never sent to external third-party servers. All signatures are generated client-side using the native browser Web Crypto API (`window.crypto.subtle`).

### 3. Quantitative AI Trading Strategies
1. **Institutional Ensemble Hybrid (Recommended)**: Combines 5-level Order Book Imbalance, Micro-Price divergence, and 3-second trade flow momentum to execute high-confidence entries.
2. **L2 Order Book Imbalance (OBI) Scalper**: Detects rapid buy/sell queue buildup across 5 depth levels:
   $$\text{OBI}_{w5} = \frac{\sum_{i=1}^{5} \frac{V_{bid, i}}{i+1} - \sum_{i=1}^{5} \frac{V_{ask, i}}{i+1}}{\sum_{i=1}^{5} \frac{V_{bid, i}}{i+1} + \sum_{i=1}^{5} \frac{V_{ask, i}}{i+1}}$$
3. **Micro-Price Gap & Queue Depletion Arbitrage**: Calculates the volume-weighted fair value:
   $$\text{MicroPrice} = \frac{V_{bid} \cdot P_{ask} + V_{ask} \cdot P_{bid}}{V_{bid} + V_{ask}}$$
   Front-runs imminent queue exhaustion when the micro-price diverges from the mid-price by the threshold basis points ($\Delta_{bps}$).
4. **AI Micro-Alpha Momentum**: Tracks trade flow toxicity (VPIN proxy) and rapid taker volume surges.

### 4. Advanced Risk Management & Safety Guardrails
- **Automated Take-Profit**: Configurable in basis points (default 15 bps = +0.15%).
- **Trailing Stop Profit**: Locks in accumulated gains once in profit by trailing behind the highest mark price.
- **Dynamic Cut-Loss**: Immediate stop-loss protection (default 10 bps = -0.10%).
- **Adverse Book Collapse Guard**: Automatically exits open positions if the order book imbalance reverses violently against the trade (e.g. OBI drops below -75% while Long).
- **🚨 Emergency Kill Switch**: Instant one-click override that turns off Auto-Pilot, cancels pending orders, and liquidates open positions to cash.

---

## 🖥️ Standalone Python HFT Bot (`python/binance_hft_bot.py`)

For deployment on a dedicated VPS or server close to Binance AWS infrastructure (`ap-northeast-1` Tokyo), a zero-dependency standalone Python bot is included.

### Run in Paper Mode (Zero Risk, Live Data):
```bash
python3 python/binance_hft_bot.py --symbol BTCUSDT --mode paper --size 100 --tp 15 --sl 10
```

### Run on Binance Testnet:
```bash
python3 python/binance_hft_bot.py --symbol BTCUSDT --mode testnet --key "YOUR_TESTNET_KEY" --secret "YOUR_TESTNET_SECRET"
```

### Run on Binance Live:
```bash
python3 python/binance_hft_bot.py --symbol BTCUSDT --mode live --key "YOUR_LIVE_KEY" --secret "YOUR_LIVE_SECRET"
```

### CLI Parameters:
- `--symbol`: Trading pair (default `BTCUSDT`, e.g. `ETHUSDT`, `SOLUSDT`).
- `--mode`: `paper`, `testnet`, or `live`.
- `--size`: Position size in USDT (default `$100`).
- `--tp`: Take-profit target in basis points (default `15` = 0.15%).
- `--sl`: Stop-loss protection in basis points (default `10` = 0.10%).
- `--obi`: Imbalance threshold (default `0.60` = 60%).

---

## 📁 Repository Structure
```
├── index.html                   # Quant Trading Terminal dashboard UI
├── css/
│   └── terminal.css             # Institutional dark Bloomberg-style styling
├── js/
│   ├── binance_feed.js          # Live Binance WebSockets (Depth20, AggTrades, Klines)
│   ├── orderbook_engine.js      # L2 order book, OBI & Micro-Price math engine
│   ├── hft_strategy.js          # AI alpha signals & decision rules
│   ├── execution_engine.js      # Paper execution (~0.8ms) & Binance REST API signer
│   ├── chart_engine.js          # 60 FPS Canvas chart with micro-price & execution flags
│   └── terminal_app.js          # Master controller & Web Audio synthesizer
├── python/
│   └── binance_hft_bot.py       # Standalone Python bot (Zero pip dependencies)
└── README.md
```

# Algo Trader

A real-time algorithmic trading dashboard built with Next.js, featuring AI-powered signal generation and mean reversion strategy.

## Features

- **Real-time Dashboard**: Live equity curve, positions tracking, and strategic trade planning
- **Mean Reversion Strategy**: Automated signal generation based on support/resistance levels
- **Paper/Live Mode**: Toggle between simulated and live trading with Dhan broker
- **Kill Switch**: Emergency stop functionality to halt all trading activity
- **Market Hours Detection**: Automatic handling of NSE market hours (9:15 AM - 3:30 PM IST)
- **Risk Management**: Configurable max daily loss and per-trade risk limits

## Tech Stack

- **Framework**: Next.js 16 with TypeScript
- **Charts**: Recharts for equity curve visualization
- **Styling**: TailwindCSS with custom dark theme
- **Broker**: Dhan API for live market data and order execution

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/yourusername/algo-trader.git
cd algo-trader
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DHAN_CLIENT_ID` | Your Dhan broker client ID |
| `DHAN_ACCESS_TOKEN` | Your Dhan API access token |
| `GEMINI_API_KEY` | Gemini AI API key (for future AI features) |
| `DEFAULT_BROKER` | Set to `MOCK` for paper trading, `DHAN` for live |

## Dashboard Features

- **Stats Grid**: Daily PnL, Risk Consumed, Market Regime, Execution Engine status
- **Equity Curve**: Real-time visualization of portfolio value
- **Active Positions**: Current open trades with entry, LTP, and PnL
- **Strategic Trade Planning**: Bullish and bearish setups for watchlist stocks
- **Live Watchlist**: Top 20 NSE stocks with real-time status
- **System Logs**: Timestamped activity log

## License

MIT


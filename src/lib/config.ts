// Trading Configuration
export const CONFIG = {
    // Strategy Parameters
    TARGET_TREND_MULT: 0.5,
    WICK_RATIO: 0.3,  // Relaxed from 1.0
    VOLUME_RATIO: 0.7, // Relaxed from 1.0

    // Risk Management
    MAX_DRAWDOWN: 1.5,
    MAX_DAILY_LOSS: 5000,

    // Regime Thresholds
    TSD_THRESHOLD_A: 3,
    TSD_THRESHOLD_B: 7,

    // Watchlist (Top NSE Stocks)
    WATCHLIST: [
        "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
        "SBIN", "AXISBANK", "BHARTIARTL", "ITC", "LT",
        "KOTAKBANK", "WIPRO", "MARUTI", "TITAN", "SUNPHARMA",
        "BAJFINANCE", "NESTLEIND", "ADANIENT", "TATASTEEL", "POWERGRID"
    ]
};

// Market Data Utilities
// Replaces previous mock implementations with professional utility functions

export interface OHLCV {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp?: Date;
}

// In-memory cache for prior tick data (for change calculations)
const priorData: Record<string, OHLCV> = {};

export function getPriorData(symbol: string): OHLCV | null {
    return priorData[symbol] ?? null;
}

export function updatePriorData(data: Record<string, OHLCV>) {
    for (const [symbol, ohlcv] of Object.entries(data)) {
        priorData[symbol] = ohlcv;
    }
}

// Calculate Support/Resistance levels
// Uses historical data for proper swing levels when available
export function calculateLevels(data: OHLCV, historicalData?: OHLCV[]): { support: number; resistance: number } {
    // If we have historical data, use proper swing levels (20-candle lookback)
    if (historicalData && historicalData.length >= 20) {
        const last20 = historicalData.slice(-20);
        const swingHigh = Math.max(...last20.map(c => c.high));
        const swingLow = Math.min(...last20.map(c => c.low));
        return {
            support: swingLow,
            resistance: swingHigh
        };
    }
    // Fallback based on daily range (Standard Pivot concept approximation or simple range check)
    const range = data.high - data.low;
    return {
        support: data.low - range * 0.5,
        resistance: data.high + range * 0.5
    };
}

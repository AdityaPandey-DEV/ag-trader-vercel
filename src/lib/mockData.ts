// Mock Market Data Generator
// Simulates realistic OHLCV data for demo purposes

interface OHLCV {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// Base prices for each symbol (approx real values)
const BASE_PRICES: Record<string, number> = {
    RELIANCE: 2950, TCS: 4200, INFY: 1850, HDFCBANK: 1720, ICICIBANK: 1250,
    SBIN: 820, AXISBANK: 1180, BHARTIARTL: 1650, ITC: 480, LT: 3650,
    KOTAKBANK: 1850, WIPRO: 560, MARUTI: 12500, TITAN: 3750, SUNPHARMA: 1850,
    BAJFINANCE: 7200, NESTLEIND: 2450, ADANIENT: 2950, TATASTEEL: 155, POWERGRID: 320
};

// Cache to maintain price continuity
const priceCache: Record<string, number> = {};
const priorData: Record<string, OHLCV> = {};

export function generateMockData(symbols: string[]): Record<string, OHLCV> {
    const result: Record<string, OHLCV> = {};

    for (const symbol of symbols) {
        // Get base or cached price
        const basePrice = priceCache[symbol] ?? BASE_PRICES[symbol] ?? 1000;

        // Random walk: -1% to +1%
        const change = (Math.random() - 0.5) * 0.02;
        const newPrice = basePrice * (1 + change);

        // Generate OHLCV
        const volatility = 0.005; // 0.5% intraday range
        const open = newPrice * (1 + (Math.random() - 0.5) * volatility);
        const high = Math.max(open, newPrice) * (1 + Math.random() * volatility);
        const low = Math.min(open, newPrice) * (1 - Math.random() * volatility);
        const close = newPrice;
        const volume = Math.floor(100000 + Math.random() * 500000);

        result[symbol] = { symbol, open, high, low, close, volume };
        priceCache[symbol] = close; // Update cache
    }

    return result;
}

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
    // Fallback: widen the range significantly (0.5x instead of 0.1x)
    const range = data.high - data.low;
    return {
        support: data.low - range * 0.5,
        resistance: data.high + range * 0.5
    };
}

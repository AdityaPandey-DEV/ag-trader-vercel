// Technical Indicators Library
// Core calculations for regime detection and strategy

export interface OHLCV {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp?: Date;
}

/**
 * Simple Moving Average
 * SMA = sum(values) / period
 */
export function calculateSMA(values: number[], period: number): number {
    if (values.length < period) {
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average
 * EMA = (Close - EMA_prev) * multiplier + EMA_prev
 * multiplier = 2 / (period + 1)
 */
export function calculateEMA(prices: number[], period: number): number[] {
    if (prices.length === 0) return [];
    if (prices.length < period) {
        // Return SMA for insufficient data
        const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
        return prices.map(() => sma);
    }

    const multiplier = 2 / (period + 1);
    const ema: number[] = [];

    // First EMA is the SMA of first 'period' values
    const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    ema.push(initialSMA);

    // Calculate EMA for remaining values
    for (let i = period; i < prices.length; i++) {
        const prevEMA = ema[ema.length - 1];
        const newEMA = (prices[i] - prevEMA) * multiplier + prevEMA;
        ema.push(newEMA);
    }

    return ema;
}

/**
 * Get current EMA value (latest)
 */
export function getCurrentEMA(prices: number[], period: number): number {
    const ema = calculateEMA(prices, period);
    return ema.length > 0 ? ema[ema.length - 1] : 0;
}

/**
 * Average True Range (ATR)
 * TR = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
 * ATR = SMA(TR, period)
 */
export function calculateATR(candles: OHLCV[], period: number = 14): number[] {
    if (candles.length < 2) return [0];

    const trueRanges: number[] = [];

    // First TR is just High - Low
    trueRanges.push(candles[0].high - candles[0].low);

    // Calculate TR for remaining candles
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);

        trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    // Calculate ATR as EMA of True Ranges
    return calculateEMA(trueRanges, period);
}

/**
 * Get current ATR value (latest)
 */
export function getCurrentATR(candles: OHLCV[], period: number = 14): number {
    const atr = calculateATR(candles, period);
    return atr.length > 0 ? atr[atr.length - 1] : 0;
}

/**
 * Calculate slope of a series using linear regression
 * Slope = (n * Σ(xy) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
 */
export function calculateSlope(values: number[], period: number): number {
    if (values.length < 2) return 0;

    const n = Math.min(values.length, period);
    const slice = values.slice(-n);

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += slice[i];
        sumXY += i * slice[i];
        sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Base Range (R) - Average of High-Low over period
 * R = SMA(High - Low, period)
 */
export function calculateBaseRange(candles: OHLCV[], period: number = 20): number {
    if (candles.length === 0) return 0;

    const ranges = candles.map(c => c.high - c.low);
    return calculateSMA(ranges, period);
}

/**
 * Trend Shift (T) - Slope of EMA(200)
 * T = slope of EMA(200) over recent period
 */
export function calculateTrendShift(closePrices: number[], emaPeriod: number = 200, slopePeriod: number = 5): number {
    const ema = calculateEMA(closePrices, emaPeriod);
    if (ema.length < slopePeriod) return 0;

    return calculateSlope(ema, slopePeriod);
}

/**
 * Detect Trend Shift Day
 * TSD = |T_day| > 0.7 × R_day
 */
export function isTrendShiftDay(trendShift: number, baseRange: number, threshold: number = 0.7): boolean {
    if (baseRange === 0) return false;
    return Math.abs(trendShift) > threshold * baseRange;
}

/**
 * Calculate Relative Strength Index (RSI)
 * For future use in confirmation filters
 */
export function calculateRSI(closePrices: number[], period: number = 14): number {
    if (closePrices.length < period + 1) return 50; // Neutral

    const changes: number[] = [];
    for (let i = 1; i < closePrices.length; i++) {
        changes.push(closePrices[i] - closePrices[i - 1]);
    }

    const recentChanges = changes.slice(-period);
    let gains = 0;
    let losses = 0;

    for (const change of recentChanges) {
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Calculate Bollinger Bands
 * For future use in volatility analysis
 */
export function calculateBollingerBands(closePrices: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
} {
    if (closePrices.length === 0) {
        return { upper: 0, middle: 0, lower: 0 };
    }

    const sma = calculateSMA(closePrices, period);
    const slice = closePrices.slice(-Math.min(closePrices.length, period));

    // Calculate standard deviation
    const squaredDiffs = slice.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / slice.length;
    const std = Math.sqrt(variance);

    return {
        upper: sma + stdDev * std,
        middle: sma,
        lower: sma - stdDev * std
    };
}

/**
 * Session metrics aggregator
 * Combines all metrics for a trading session
 */
export interface SessionMetrics {
    baseRange: number;          // R
    trendShift: number;         // T
    ema200: number;
    atr14: number;
    rsi14: number;
    isTSD: boolean;             // Trend Shift Day
    timestamp: Date;
}

export function calculateSessionMetrics(candles: OHLCV[]): SessionMetrics {
    const closePrices = candles.map(c => c.close);

    const baseRange = calculateBaseRange(candles, 20);
    const trendShift = calculateTrendShift(closePrices, 200, 5);
    const ema200 = getCurrentEMA(closePrices, 200);
    const atr14 = getCurrentATR(candles, 14);
    const rsi14 = calculateRSI(closePrices, 14);
    const isTSD = isTrendShiftDay(trendShift, baseRange, 0.7);

    return {
        baseRange,
        trendShift,
        ema200,
        atr14,
        rsi14,
        isTSD,
        timestamp: new Date()
    };
}

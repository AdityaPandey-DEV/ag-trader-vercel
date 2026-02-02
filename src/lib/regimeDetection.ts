// ADX (Average Directional Index) Calculation
// Used for regime detection: trending vs choppy markets

import { OHLCV } from './indicators';

export interface RegimeInfo {
    regime: 'TRENDING' | 'NORMAL' | 'CHOPPY';
    adx: number;
    strength: string;
    shouldTrade: boolean;
    filterConfig: {
        minEmaSlope: number;
        minTradeScore: number;
        minFirstHourRangeATR: number;
    };
}

/**
 * Calculate ADX (Average Directional Index)
 * ADX measures trend strength (0-100)
 * - ADX > 25: Strong trend
 * - ADX 15-25: Moderate trend
 * - ADX < 15: Weak trend / choppy
 */
export function calculateADX(candles: OHLCV[], period: number = 14): number {
    if (candles.length < period + 1) {
        return 0;
    }

    const trueRanges: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];

    // Calculate TR, +DM, -DM for each candle
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevHigh = candles[i - 1].high;
        const prevLow = candles[i - 1].low;
        const prevClose = candles[i - 1].close;

        // True Range
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trueRanges.push(tr);

        // Directional Movement
        const upMove = high - prevHigh;
        const downMove = prevLow - low;

        let plusDMValue = 0;
        let minusDMValue = 0;

        if (upMove > downMove && upMove > 0) {
            plusDMValue = upMove;
        }
        if (downMove > upMove && downMove > 0) {
            minusDMValue = downMove;
        }

        plusDM.push(plusDMValue);
        minusDM.push(minusDMValue);
    }

    if (trueRanges.length < period) {
        return 0;
    }

    // Smooth TR, +DM, -DM using Wilder's smoothing
    const smoothTR = wilderSmooth(trueRanges, period);
    const smoothPlusDM = wilderSmooth(plusDM, period);
    const smoothMinusDM = wilderSmooth(minusDM, period);

    // Calculate +DI and -DI
    const plusDI: number[] = [];
    const minusDI: number[] = [];

    for (let i = 0; i < smoothTR.length; i++) {
        if (smoothTR[i] === 0) {
            plusDI.push(0);
            minusDI.push(0);
        } else {
            plusDI.push((smoothPlusDM[i] / smoothTR[i]) * 100);
            minusDI.push((smoothMinusDM[i] / smoothTR[i]) * 100);
        }
    }

    // Calculate DX
    const dx: number[] = [];
    for (let i = 0; i < plusDI.length; i++) {
        const diSum = plusDI[i] + minusDI[i];
        if (diSum === 0) {
            dx.push(0);
        } else {
            const diDiff = Math.abs(plusDI[i] - minusDI[i]);
            dx.push((diDiff / diSum) * 100);
        }
    }

    // Calculate ADX (smoothed DX)
    if (dx.length < period) {
        return 0;
    }

    const adxValues = wilderSmooth(dx, period);
    return adxValues[adxValues.length - 1];
}

/**
 * Wilder's smoothing method
 * First value: simple average of first N values
 * Subsequent values: (previous * (N-1) + current) / N
 */
function wilderSmooth(values: number[], period: number): number[] {
    if (values.length < period) {
        return [];
    }

    const smoothed: number[] = [];

    // First smoothed value is simple average
    const firstSum = values.slice(0, period).reduce((a, b) => a + b, 0);
    smoothed.push(firstSum / period);

    // Subsequent values use Wilder's smoothing
    for (let i = period; i < values.length; i++) {
        const prev = smoothed[smoothed.length - 1];
        const current = values[i];
        const next = (prev * (period - 1) + current) / period;
        smoothed.push(next);
    }

    return smoothed;
}

/**
 * Detect market regime based on ADX
 * Returns regime type and recommended filter settings
 */
export function detectMarketRegime(candles: OHLCV[]): RegimeInfo {
    const adx = calculateADX(candles, 14);

    let regime: 'TRENDING' | 'NORMAL' | 'CHOPPY';
    let strength: string;
    let shouldTrade: boolean;
    let filterConfig: RegimeInfo['filterConfig'];

    if (adx >= 25) {
        // Strong trend - use strict filters for quality
        regime = 'TRENDING';
        strength = 'Strong';
        shouldTrade = true;
        filterConfig = {
            minEmaSlope: 0.01,      // 1% slope (strict)
            minTradeScore: 0.7,     // 70% quality (strict)
            minFirstHourRangeATR: 0.4  // 40% ATR
        };
    } else if (adx >= 15) {
        // Moderate trend - use relaxed filters
        regime = 'NORMAL';
        strength = 'Moderate';
        shouldTrade = true;
        filterConfig = {
            minEmaSlope: 0.003,     // 0.3% slope (relaxed)
            minTradeScore: 0.5,     // 50% quality (relaxed)
            minFirstHourRangeATR: 0.3  // 30% ATR
        };
    } else {
        // Weak trend / choppy - skip trading or use very relaxed filters
        regime = 'CHOPPY';
        strength = 'Weak';
        shouldTrade = false;  // Skip trading in choppy markets
        filterConfig = {
            minEmaSlope: 0.0,       // Disabled
            minTradeScore: 0.8,     // 80% quality (very strict if trading)
            minFirstHourRangeATR: 0.5  // 50% ATR
        };
    }

    return {
        regime,
        adx,
        strength,
        shouldTrade,
        filterConfig
    };
}

/**
 * Get regime description for logging
 */
export function getRegimeDescription(regime: RegimeInfo): string {
    const { regime: type, adx, strength, shouldTrade } = regime;

    let description = `${type} market (ADX: ${adx.toFixed(1)}, ${strength} trend)`;

    if (!shouldTrade) {
        description += ' - SKIPPING TRADES';
    }

    return description;
}

/**
 * Calculate ATR (Average True Range) - helper for regime detection
 */
export function calculateATR(candles: OHLCV[], period: number = 14): number {
    if (candles.length < 2) {
        return 0;
    }

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );

        trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
        const sum = trueRanges.reduce((a, b) => a + b, 0);
        return trueRanges.length > 0 ? sum / trueRanges.length : 0;
    }

    // Use Wilder's smoothing for ATR
    const smoothed = wilderSmooth(trueRanges, period);
    return smoothed[smoothed.length - 1];
}

// Regime Detection Engine
// Implements Trend Shift Day (TSD) tracking and dynamic market regime classification

import { SessionMetrics, isTrendShiftDay } from './indicators';

/**
 * Market Regime Types
 * - RANGE_NEUTRAL: Mean reversion strategies work well
 * - EMERGING_TREND: Reduced position sizes, cautious trading
 * - ESTABLISHED_TREND: No counter-trend trades allowed
 */
export type MarketRegime = 'RANGE_NEUTRAL' | 'EMERGING_TREND' | 'ESTABLISHED_TREND';

/**
 * Regime-specific permissions
 * Controls what trading actions are allowed in each regime
 */
export interface RegimePermissions {
    regime: MarketRegime;
    allowMeanReversion: boolean;
    allowTrendFollowing: boolean;
    maxPositionSizeMultiplier: number;  // 1.0 = full size, 0.5 = half size
    maxConcurrentTrades: number;
    tradingFrequency: 'NORMAL' | 'REDUCED' | 'HALTED';
}

/**
 * TSD (Trend Shift Day) Engine State
 * Tracks consecutive trend shift days with persistence
 */
export interface TSDEngineState {
    tsdCount: number;           // Consecutive TSD count
    lastTSDDate: Date | null;   // Last detected TSD
    regime: MarketRegime;       // Current regime
    history: TSDHistoryEntry[]; // Recent history for analysis
}

interface TSDHistoryEntry {
    date: Date;
    isTSD: boolean;
    trendShift: number;
    baseRange: number;
}

// In-memory state (would be persisted to DB in production)
let engineState: TSDEngineState = {
    tsdCount: 0,
    lastTSDDate: null,
    regime: 'RANGE_NEUTRAL',
    history: []
};

/**
 * Initialize or reset the TSD engine
 */
export function initializeTSDEngine(): void {
    engineState = {
        tsdCount: 0,
        lastTSDDate: null,
        regime: 'RANGE_NEUTRAL',
        history: []
    };
}

/**
 * Get current engine state
 */
export function getTSDEngineState(): TSDEngineState {
    return { ...engineState };
}

/**
 * Detect if current session is a Trend Shift Day
 * TSD = |T_day| > 0.7 × R_day
 */
export function detectTrendShiftDay(
    trendShift: number,
    baseRange: number,
    threshold: number = 0.7
): boolean {
    return isTrendShiftDay(trendShift, baseRange, threshold);
}

/**
 * Update TSD count based on current day's analysis
 * - If TSD detected: increment count
 * - If not TSD: apply decay
 */
export function updateTSDCount(isTSD: boolean): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isTSD) {
        // Increment on TSD
        engineState.tsdCount += 1;
        engineState.lastTSDDate = today;
    } else {
        // Apply decay: reduce by 1, minimum 0
        engineState.tsdCount = Math.max(0, engineState.tsdCount - 1);
    }

    // Update regime based on new TSD count
    engineState.regime = determineRegime(engineState.tsdCount);

    return engineState.tsdCount;
}

/**
 * Apply decay to TSD count
 * Called when condition fails or at start of new session
 */
export function applyTSDDecay(decayAmount: number = 1): number {
    engineState.tsdCount = Math.max(0, engineState.tsdCount - decayAmount);
    engineState.regime = determineRegime(engineState.tsdCount);
    return engineState.tsdCount;
}

/**
 * Determine market regime based on TSD count
 * Using configurable thresholds
 */
export function determineRegime(
    tsdCount: number,
    thresholdA: number = 3,
    thresholdB: number = 7
): MarketRegime {
    if (tsdCount < thresholdA) {
        return 'RANGE_NEUTRAL';
    } else if (tsdCount < thresholdB) {
        return 'EMERGING_TREND';
    } else {
        return 'ESTABLISHED_TREND';
    }
}

/**
 * Get trading permissions for current regime
 */
export function getRegimePermissions(regime?: MarketRegime): RegimePermissions {
    const currentRegime = regime ?? engineState.regime;

    switch (currentRegime) {
        case 'RANGE_NEUTRAL':
            return {
                regime: 'RANGE_NEUTRAL',
                allowMeanReversion: true,
                allowTrendFollowing: false,
                maxPositionSizeMultiplier: 1.0,
                maxConcurrentTrades: 4,
                tradingFrequency: 'NORMAL'
            };

        case 'EMERGING_TREND':
            return {
                regime: 'EMERGING_TREND',
                allowMeanReversion: true,  // Cautious mean reversion
                allowTrendFollowing: true, // Start trend following
                maxPositionSizeMultiplier: 0.5,
                maxConcurrentTrades: 2,
                tradingFrequency: 'REDUCED'
            };

        case 'ESTABLISHED_TREND':
            return {
                regime: 'ESTABLISHED_TREND',
                allowMeanReversion: false, // No counter-trend
                allowTrendFollowing: true,
                maxPositionSizeMultiplier: 0.25,
                maxConcurrentTrades: 1,
                tradingFrequency: 'REDUCED'
            };

        default:
            return {
                regime: 'RANGE_NEUTRAL',
                allowMeanReversion: true,
                allowTrendFollowing: false,
                maxPositionSizeMultiplier: 1.0,
                maxConcurrentTrades: 4,
                tradingFrequency: 'NORMAL'
            };
    }
}

/**
 * Check if a specific trade type is allowed in current regime
 */
export function isTradeAllowed(
    tradeType: 'MEAN_REVERSION' | 'TREND_FOLLOWING',
    regime?: MarketRegime
): boolean {
    const permissions = getRegimePermissions(regime);

    if (tradeType === 'MEAN_REVERSION') {
        return permissions.allowMeanReversion;
    } else {
        return permissions.allowTrendFollowing;
    }
}

/**
 * Process daily session metrics and update regime
 * Called at end of each trading day
 */
export function processDailyMetrics(metrics: SessionMetrics): {
    isTSD: boolean;
    newTSDCount: number;
    newRegime: MarketRegime;
    permissions: RegimePermissions;
} {
    const isTSD = metrics.isTSD;

    // Record history
    engineState.history.push({
        date: metrics.timestamp,
        isTSD,
        trendShift: metrics.trendShift,
        baseRange: metrics.baseRange
    });

    // Keep only last 30 days
    if (engineState.history.length > 30) {
        engineState.history = engineState.history.slice(-30);
    }

    // Update TSD count
    const newTSDCount = updateTSDCount(isTSD);
    const newRegime = engineState.regime;
    const permissions = getRegimePermissions(newRegime);

    return {
        isTSD,
        newTSDCount,
        newRegime,
        permissions
    };
}

/**
 * Get regime display info for dashboard
 */
export function getRegimeDisplayInfo(regime?: MarketRegime): {
    label: string;
    color: string;
    description: string;
} {
    const currentRegime = regime ?? engineState.regime;

    switch (currentRegime) {
        case 'RANGE_NEUTRAL':
            return {
                label: 'RANGE / NEUTRAL',
                color: '#10b981', // Green
                description: 'Mean reversion active. Full position sizing.'
            };

        case 'EMERGING_TREND':
            return {
                label: 'EMERGING TREND',
                color: '#f59e0b', // Amber
                description: 'Reduced sizing. Cautious mean reversion.'
            };

        case 'ESTABLISHED_TREND':
            return {
                label: 'ESTABLISHED TREND',
                color: '#ef4444', // Red
                description: 'No counter-trend trades. Trend following only.'
            };

        default:
            return {
                label: 'UNKNOWN',
                color: '#64748b',
                description: 'Regime detection unavailable.'
            };
    }
}

/**
 * Manual override for testing/emergency
 */
export function setRegimeOverride(regime: MarketRegime, tsdCount?: number): void {
    engineState.regime = regime;
    if (tsdCount !== undefined) {
        engineState.tsdCount = tsdCount;
    }
}

/**
 * Export current state for persistence
 */
export function exportState(): TSDEngineState {
    return JSON.parse(JSON.stringify(engineState));
}

/**
 * Import state from persistence
 */
export function importState(state: TSDEngineState): void {
    engineState = {
        ...state,
        lastTSDDate: state.lastTSDDate ? new Date(state.lastTSDDate) : null,
        history: state.history.map(h => ({
            ...h,
            date: new Date(h.date)
        }))
    };
}

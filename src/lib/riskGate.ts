// Risk Management Gate
// Centralized risk checks that must pass before any trade execution

import { CONFIG } from './config';
import { getStateMachine, ManagedPosition } from './stateMachine';
import { getRegimePermissions, MarketRegime } from './regimeEngine';

/**
 * Risk check result
 */
export interface RiskCheckResult {
    passed: boolean;
    checks: {
        name: string;
        passed: boolean;
        reason?: string;
    }[];
    adjustedSize?: number;  // If size was reduced due to risk
}

/**
 * Trade signal to validate
 */
export interface TradeSignal {
    symbol: string;
    side: 'LONG' | 'SHORT';
    entry: number;
    stop: number;
    target: number;
    requestedQty?: number;
}

/**
 * Risk Gate Configuration
 */
export interface RiskGateConfig {
    maxRiskPerTrade: number;        // % of capital (e.g., 0.01 = 1%)
    maxDailyDrawdown: number;       // % of capital
    maxDailyLoss: number;           // Absolute amount
    maxConcurrentPositions: number;
    maxCorrelatedPositions: number; // Same sector/theme
    maxSingleStockExposure: number; // % of capital in one stock
}

// Default configuration
const DEFAULT_CONFIG: RiskGateConfig = {
    maxRiskPerTrade: CONFIG.RISK_PER_TRADE,
    maxDailyDrawdown: CONFIG.MAX_DRAWDOWN / 100,
    maxDailyLoss: CONFIG.MAX_DAILY_LOSS,
    maxConcurrentPositions: 4,
    maxCorrelatedPositions: 2,
    maxSingleStockExposure: 0.15  // 15% max in one stock
};

// Sector mapping for correlation checks
const SECTOR_MAP: Record<string, string> = {
    'RELIANCE': 'Energy',
    'TCS': 'IT',
    'INFY': 'IT',
    'WIPRO': 'IT',
    'HDFCBANK': 'Banking',
    'ICICIBANK': 'Banking',
    'SBIN': 'Banking',
    'AXISBANK': 'Banking',
    'KOTAKBANK': 'Banking',
    'BHARTIARTL': 'Telecom',
    'ITC': 'FMCG',
    'LT': 'Infra',
    'MARUTI': 'Auto',
    'TITAN': 'Consumer',
    'SUNPHARMA': 'Pharma',
    'BAJFINANCE': 'Finance',
    'NESTLEIND': 'FMCG',
    'ADANIENT': 'Diversified',
    'TATASTEEL': 'Metals',
    'POWERGRID': 'Power'
};

/**
 * Main Risk Gate class
 */
class RiskGate {
    private config: RiskGateConfig;

    constructor(config?: Partial<RiskGateConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run all risk checks on a trade signal
     */
    validateTrade(
        signal: TradeSignal,
        capital: number,
        currentPnl: number,
        regime: MarketRegime,
        openPositions: ManagedPosition[]
    ): RiskCheckResult {
        const checks: RiskCheckResult['checks'] = [];

        // 1. Per-trade risk check
        const perTradeCheck = this.checkPerTradeRisk(signal, capital);
        checks.push(perTradeCheck);

        // 2. Daily drawdown check
        const drawdownCheck = this.checkDailyDrawdown(currentPnl, capital);
        checks.push(drawdownCheck);

        // 3. Max daily loss check
        const dailyLossCheck = this.checkMaxDailyLoss(currentPnl);
        checks.push(dailyLossCheck);

        // 4. Max concurrent positions
        const positionsCheck = this.checkMaxPositions(openPositions.length, regime);
        checks.push(positionsCheck);

        // 5. Correlation check
        const correlationCheck = this.checkCorrelation(signal.symbol, openPositions);
        checks.push(correlationCheck);

        // 6. Single stock exposure
        const exposureCheck = this.checkSingleStockExposure(
            signal,
            capital,
            openPositions
        );
        checks.push(exposureCheck);

        // 7. State machine check
        const stateCheck = this.checkStateMachine();
        checks.push(stateCheck);

        // 8. Regime permission check
        const regimeCheck = this.checkRegimePermission(regime);
        checks.push(regimeCheck);

        // Calculate adjusted position size
        const regimePermissions = getRegimePermissions(regime);
        let adjustedQty = signal.requestedQty ?? this.calculatePositionSize(signal, capital);
        adjustedQty = Math.floor(adjustedQty * regimePermissions.maxPositionSizeMultiplier);
        adjustedQty = Math.max(1, adjustedQty); // Minimum 1 share

        const allPassed = checks.every(c => c.passed);

        return {
            passed: allPassed,
            checks,
            adjustedSize: adjustedQty
        };
    }

    /**
     * Check 1: Per-trade risk limit
     */
    private checkPerTradeRisk(signal: TradeSignal, capital: number): RiskCheckResult['checks'][0] {
        const stopDistance = Math.abs(signal.entry - signal.stop);
        const maxRiskAmount = capital * this.config.maxRiskPerTrade;
        const maxQty = Math.floor(maxRiskAmount / stopDistance);

        const requestedRisk = (signal.requestedQty ?? maxQty) * stopDistance;
        const riskPercent = (requestedRisk / capital) * 100;

        const passed = riskPercent <= this.config.maxRiskPerTrade * 100;

        return {
            name: 'Per-Trade Risk',
            passed,
            reason: passed
                ? `Risk: ${riskPercent.toFixed(2)}% (max ${this.config.maxRiskPerTrade * 100}%)`
                : `Risk ${riskPercent.toFixed(2)}% exceeds limit`
        };
    }

    /**
     * Check 2: Daily drawdown limit
     */
    private checkDailyDrawdown(currentPnl: number, capital: number): RiskCheckResult['checks'][0] {
        const drawdownPercent = Math.abs(currentPnl) / capital;
        const maxDrawdown = this.config.maxDailyDrawdown;

        // Only check if in loss
        if (currentPnl >= 0) {
            return { name: 'Daily Drawdown', passed: true, reason: 'No drawdown' };
        }

        const passed = drawdownPercent < maxDrawdown;

        return {
            name: 'Daily Drawdown',
            passed,
            reason: passed
                ? `Drawdown: ${(drawdownPercent * 100).toFixed(2)}%`
                : `Drawdown ${(drawdownPercent * 100).toFixed(2)}% exceeds ${maxDrawdown * 100}%`
        };
    }

    /**
     * Check 3: Max daily loss (absolute)
     */
    private checkMaxDailyLoss(currentPnl: number): RiskCheckResult['checks'][0] {
        if (currentPnl >= 0) {
            return { name: 'Max Daily Loss', passed: true, reason: 'In profit' };
        }

        const passed = Math.abs(currentPnl) < this.config.maxDailyLoss;

        return {
            name: 'Max Daily Loss',
            passed,
            reason: passed
                ? `Loss: ₹${Math.abs(currentPnl).toFixed(0)}`
                : `Loss ₹${Math.abs(currentPnl).toFixed(0)} exceeds ₹${this.config.maxDailyLoss}`
        };
    }

    /**
     * Check 4: Max concurrent positions
     */
    private checkMaxPositions(currentCount: number, regime: MarketRegime): RiskCheckResult['checks'][0] {
        const permissions = getRegimePermissions(regime);
        const limit = Math.min(this.config.maxConcurrentPositions, permissions.maxConcurrentTrades);

        const passed = currentCount < limit;

        return {
            name: 'Max Positions',
            passed,
            reason: passed
                ? `${currentCount}/${limit} positions`
                : `At max ${limit} positions`
        };
    }

    /**
     * Check 5: Correlation (sector concentration)
     */
    private checkCorrelation(symbol: string, openPositions: ManagedPosition[]): RiskCheckResult['checks'][0] {
        const newSector = SECTOR_MAP[symbol] || 'Unknown';
        const sectorCount = openPositions.filter(p =>
            SECTOR_MAP[p.symbol] === newSector
        ).length;

        const passed = sectorCount < this.config.maxCorrelatedPositions;

        return {
            name: 'Correlation',
            passed,
            reason: passed
                ? `${sectorCount} in ${newSector}`
                : `${sectorCount} already in ${newSector} (max ${this.config.maxCorrelatedPositions})`
        };
    }

    /**
     * Check 6: Single stock exposure
     */
    private checkSingleStockExposure(
        signal: TradeSignal,
        capital: number,
        openPositions: ManagedPosition[]
    ): RiskCheckResult['checks'][0] {
        const existingExposure = openPositions
            .filter(p => p.symbol === signal.symbol)
            .reduce((sum, p) => sum + p.entry * p.qty, 0);

        const newExposure = signal.entry * (signal.requestedQty ?? 1);
        const totalExposure = existingExposure + newExposure;
        const exposurePercent = totalExposure / capital;

        const passed = exposurePercent <= this.config.maxSingleStockExposure;

        return {
            name: 'Single Stock Exposure',
            passed,
            reason: passed
                ? `${signal.symbol}: ${(exposurePercent * 100).toFixed(1)}%`
                : `${signal.symbol} would be ${(exposurePercent * 100).toFixed(1)}% (max ${this.config.maxSingleStockExposure * 100}%)`
        };
    }

    /**
     * Check 7: State machine allows trading
     */
    private checkStateMachine(): RiskCheckResult['checks'][0] {
        const stateMachine = getStateMachine();
        const canOpen = stateMachine.canOpenPosition();

        return {
            name: 'System State',
            passed: canOpen.allowed,
            reason: canOpen.allowed ? 'Trading enabled' : canOpen.reason
        };
    }

    /**
     * Check 8: Regime allows mean reversion
     */
    private checkRegimePermission(regime: MarketRegime): RiskCheckResult['checks'][0] {
        const permissions = getRegimePermissions(regime);

        // For now, only checking mean reversion permission
        const passed = permissions.allowMeanReversion;

        return {
            name: 'Regime Permission',
            passed,
            reason: passed
                ? `${regime}: Mean reversion allowed`
                : `${regime}: Mean reversion blocked`
        };
    }

    /**
     * Calculate position size based on risk
     */
    calculatePositionSize(signal: TradeSignal, capital: number): number {
        const riskAmount = capital * this.config.maxRiskPerTrade;
        const stopDistance = Math.abs(signal.entry - signal.stop);

        if (stopDistance === 0) return 1;

        return Math.floor(riskAmount / stopDistance);
    }

    /**
     * Log risk check results
     */
    logRiskCheck(result: RiskCheckResult, signal: TradeSignal): void {
        const passedCount = result.checks.filter(c => c.passed).length;
        const status = result.passed ? '✅' : '❌';

        console.log(`[RISK] ${status} ${signal.side} ${signal.symbol}: ${passedCount}/${result.checks.length} checks passed`);

        for (const check of result.checks) {
            const icon = check.passed ? '  ✓' : '  ✗';
            console.log(`${icon} ${check.name}: ${check.reason}`);
        }
    }
}

// Singleton instance
let riskGate: RiskGate | null = null;

/**
 * Get or create risk gate instance
 */
export function getRiskGate(config?: Partial<RiskGateConfig>): RiskGate {
    if (!riskGate) {
        riskGate = new RiskGate(config);
    }
    return riskGate;
}

/**
 * Quick validation function
 */
export function validateTradeSignal(
    signal: TradeSignal,
    capital: number,
    currentPnl: number,
    regime: MarketRegime,
    openPositions: ManagedPosition[]
): RiskCheckResult {
    return getRiskGate().validateTrade(signal, capital, currentPnl, regime, openPositions);
}

/**
 * Calculate safe position size
 */
export function calculateSafePositionSize(
    signal: TradeSignal,
    capital: number,
    regime: MarketRegime
): number {
    const baseSize = getRiskGate().calculatePositionSize(signal, capital);
    const permissions = getRegimePermissions(regime);

    return Math.max(1, Math.floor(baseSize * permissions.maxPositionSizeMultiplier));
}

export { RiskGate };

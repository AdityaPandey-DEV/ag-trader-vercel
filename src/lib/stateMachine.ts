// Position & State Machine
// Implements explicit trading states with controlled transitions

/**
 * System States
 * Each state has specific permissions and valid transitions
 */
export type SystemState =
    | 'IDLE'                    // No positions, waiting for setup
    | 'WAITING_FOR_TRIGGER'     // Trade plan active, waiting for price
    | 'POSITION_OPEN'           // Active position(s)
    | 'LOCKED_AFTER_LOSS'       // Cooling off after stop-loss
    | 'HALTED_FOR_DAY';         // Trading halted (kill switch / max loss)

/**
 * State transition record
 */
export interface StateTransition {
    from: SystemState;
    to: SystemState;
    trigger: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

/**
 * Position state within the system
 */
export interface ManagedPosition {
    id: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    entry: number;
    current: number;
    qty: number;
    pnl: number;
    stopLoss: number;
    target: number;
    entryTime: Date;
    state: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CLOSED';
    regime: string;
    exitReason?: string;
}

/**
 * State Machine Configuration
 */
interface StateMachineConfig {
    lockDurationMs: number;     // How long to lock after loss
    maxDailyLosses: number;     // Max stop-losses before halt
    maxConcurrentPositions: number;
}

/**
 * State Machine Engine
 */
class TradingStateMachine {
    private state: SystemState = 'IDLE';
    private positions: ManagedPosition[] = [];
    private transitions: StateTransition[] = [];
    private dailyLossCount: number = 0;
    private lockUntil: Date | null = null;
    private config: StateMachineConfig;

    constructor(config?: Partial<StateMachineConfig>) {
        this.config = {
            lockDurationMs: 5 * 60 * 1000, // 5 minutes default lock
            maxDailyLosses: 3,
            maxConcurrentPositions: 4,
            ...config
        };
    }

    /**
     * Get current state
     */
    getState(): SystemState {
        // Check if lock period has expired
        if (this.state === 'LOCKED_AFTER_LOSS' && this.lockUntil) {
            if (new Date() > this.lockUntil) {
                this.transitionTo('IDLE', 'Lock period expired');
            }
        }
        return this.state;
    }

    /**
     * Get all positions
     */
    getPositions(): ManagedPosition[] {
        return [...this.positions];
    }

    /**
     * Get open positions only
     */
    getOpenPositions(): ManagedPosition[] {
        return this.positions.filter(p => p.state === 'FILLED' || p.state === 'PARTIAL');
    }

    /**
     * Get transition history
     */
    getTransitions(): StateTransition[] {
        return [...this.transitions];
    }

    /**
     * Check if new position can be opened
     */
    canOpenPosition(): { allowed: boolean; reason?: string } {
        const currentState = this.getState();

        switch (currentState) {
            case 'HALTED_FOR_DAY':
                return { allowed: false, reason: 'Trading halted for the day' };

            case 'LOCKED_AFTER_LOSS':
                const remaining = this.lockUntil
                    ? Math.ceil((this.lockUntil.getTime() - Date.now()) / 1000)
                    : 0;
                return { allowed: false, reason: `Locked for ${remaining}s after loss` };

            case 'POSITION_OPEN':
                if (this.getOpenPositions().length >= this.config.maxConcurrentPositions) {
                    return { allowed: false, reason: 'Max concurrent positions reached' };
                }
                return { allowed: true };

            case 'IDLE':
            case 'WAITING_FOR_TRIGGER':
                return { allowed: true };

            default:
                return { allowed: false, reason: 'Unknown state' };
        }
    }

    /**
     * Open a new position
     */
    openPosition(position: Omit<ManagedPosition, 'id' | 'state' | 'entryTime'>): ManagedPosition | null {
        const check = this.canOpenPosition();
        if (!check.allowed) {
            console.log(`[STATE] Cannot open position: ${check.reason}`);
            return null;
        }

        const newPosition: ManagedPosition = {
            ...position,
            id: `POS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            state: 'FILLED',
            entryTime: new Date()
        };

        this.positions.push(newPosition);
        this.transitionTo('POSITION_OPEN', `Opened ${position.side} ${position.symbol}`);

        return newPosition;
    }

    /**
     * Close a position
     */
    closePosition(positionId: string, exitReason: string, exitPrice: number): ManagedPosition | null {
        const position = this.positions.find(p => p.id === positionId);
        if (!position || position.state === 'CLOSED') {
            return null;
        }

        // Calculate final PnL
        const finalPnl = position.side === 'LONG'
            ? (exitPrice - position.entry) * position.qty
            : (position.entry - exitPrice) * position.qty;

        position.current = exitPrice;
        position.pnl = Number(finalPnl.toFixed(2));
        position.state = 'CLOSED';
        position.exitReason = exitReason;

        // Check if this was a loss (stop-loss hit)
        const isStopLoss = exitReason.toLowerCase().includes('stop') ||
            exitReason.toLowerCase().includes('sl') ||
            finalPnl < 0;

        if (isStopLoss && finalPnl < 0) {
            this.dailyLossCount++;

            if (this.dailyLossCount >= this.config.maxDailyLosses) {
                this.transitionTo('HALTED_FOR_DAY', `Max daily losses (${this.config.maxDailyLosses}) reached`);
            } else {
                this.lockUntil = new Date(Date.now() + this.config.lockDurationMs);
                this.transitionTo('LOCKED_AFTER_LOSS', `Stop-loss hit (${this.dailyLossCount}/${this.config.maxDailyLosses})`);
            }
        } else {
            // Check if all positions are now closed
            if (this.getOpenPositions().length === 0) {
                this.transitionTo('IDLE', 'All positions closed');
            }
        }

        return position;
    }

    /**
     * Set waiting for trigger state
     */
    setWaitingForTrigger(triggerDescription: string): void {
        if (this.state === 'IDLE') {
            this.transitionTo('WAITING_FOR_TRIGGER', triggerDescription);
        }
    }

    /**
     * Cancel waiting state
     */
    cancelWaiting(): void {
        if (this.state === 'WAITING_FOR_TRIGGER') {
            this.transitionTo('IDLE', 'Waiting cancelled');
        }
    }

    /**
     * Activate kill switch
     */
    activateKillSwitch(reason: string): void {
        this.transitionTo('HALTED_FOR_DAY', `Kill switch: ${reason}`);
    }

    /**
     * Deactivate kill switch (manual override)
     */
    deactivateKillSwitch(): void {
        if (this.state === 'HALTED_FOR_DAY') {
            const openCount = this.getOpenPositions().length;
            this.transitionTo(
                openCount > 0 ? 'POSITION_OPEN' : 'IDLE',
                'Kill switch deactivated'
            );
        }
    }

    /**
     * Reset for new trading day
     */
    resetForNewDay(): void {
        this.dailyLossCount = 0;
        this.lockUntil = null;
        this.positions = this.positions.filter(p => p.state !== 'CLOSED');

        if (this.state === 'HALTED_FOR_DAY' || this.state === 'LOCKED_AFTER_LOSS') {
            this.transitionTo('IDLE', 'New trading day');
        }

        this.transitions = []; // Clear transition history
    }

    /**
     * Update position prices
     */
    updatePositionPrices(priceMap: Record<string, number>): void {
        for (const position of this.positions) {
            if (position.state === 'FILLED' && priceMap[position.symbol]) {
                position.current = priceMap[position.symbol];
                position.pnl = position.side === 'LONG'
                    ? (position.current - position.entry) * position.qty
                    : (position.entry - position.current) * position.qty;
                position.pnl = Number(position.pnl.toFixed(2));
            }
        }
    }

    /**
     * Check stop-losses and targets
     */
    checkExits(priceMap: Record<string, number>): string[] {
        const closedPositions: string[] = [];

        for (const position of this.getOpenPositions()) {
            const currentPrice = priceMap[position.symbol];
            if (!currentPrice) continue;

            // Check stop-loss
            if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
                this.closePosition(position.id, 'Stop-loss hit', currentPrice);
                closedPositions.push(`${position.symbol} SL @ ${currentPrice}`);
            } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
                this.closePosition(position.id, 'Stop-loss hit', currentPrice);
                closedPositions.push(`${position.symbol} SL @ ${currentPrice}`);
            }

            // Check target
            if (position.side === 'LONG' && currentPrice >= position.target) {
                this.closePosition(position.id, 'Target hit', currentPrice);
                closedPositions.push(`${position.symbol} TGT @ ${currentPrice}`);
            } else if (position.side === 'SHORT' && currentPrice <= position.target) {
                this.closePosition(position.id, 'Target hit', currentPrice);
                closedPositions.push(`${position.symbol} TGT @ ${currentPrice}`);
            }
        }

        return closedPositions;
    }

    /**
     * Private: Transition to new state
     */
    private transitionTo(newState: SystemState, trigger: string, metadata?: Record<string, any>): void {
        const transition: StateTransition = {
            from: this.state,
            to: newState,
            trigger,
            timestamp: new Date(),
            metadata
        };

        this.transitions.push(transition);

        // Keep only last 50 transitions
        if (this.transitions.length > 50) {
            this.transitions = this.transitions.slice(-50);
        }

        console.log(`[STATE] ${this.state} → ${newState}: ${trigger}`);
        this.state = newState;
    }

    /**
     * Get state summary for dashboard
     */
    getStateSummary(): {
        state: SystemState;
        stateLabel: string;
        openPositions: number;
        dailyLossCount: number;
        isLocked: boolean;
        lockRemainingSeconds: number;
        canTrade: boolean;
    } {
        const currentState = this.getState();
        const lockRemaining = this.lockUntil
            ? Math.max(0, Math.ceil((this.lockUntil.getTime() - Date.now()) / 1000))
            : 0;

        const stateLabels: Record<SystemState, string> = {
            'IDLE': 'Ready',
            'WAITING_FOR_TRIGGER': 'Waiting',
            'POSITION_OPEN': 'Active',
            'LOCKED_AFTER_LOSS': `Locked (${lockRemaining}s)`,
            'HALTED_FOR_DAY': 'Halted'
        };

        return {
            state: currentState,
            stateLabel: stateLabels[currentState],
            openPositions: this.getOpenPositions().length,
            dailyLossCount: this.dailyLossCount,
            isLocked: currentState === 'LOCKED_AFTER_LOSS' || currentState === 'HALTED_FOR_DAY',
            lockRemainingSeconds: lockRemaining,
            canTrade: this.canOpenPosition().allowed
        };
    }

    /**
     * Export state for persistence
     */
    exportState(): {
        state: SystemState;
        positions: ManagedPosition[];
        dailyLossCount: number;
        lockUntil: string | null;
    } {
        return {
            state: this.state,
            positions: this.positions,
            dailyLossCount: this.dailyLossCount,
            lockUntil: this.lockUntil?.toISOString() ?? null
        };
    }

    /**
     * Import state from persistence
     */
    importState(data: ReturnType<typeof this.exportState>): void {
        this.state = data.state;
        this.positions = data.positions.map(p => ({
            ...p,
            entryTime: new Date(p.entryTime)
        }));
        this.dailyLossCount = data.dailyLossCount;
        this.lockUntil = data.lockUntil ? new Date(data.lockUntil) : null;
    }
}

// Singleton instance
let stateMachine: TradingStateMachine | null = null;

/**
 * Get or create state machine instance
 */
export function getStateMachine(config?: Partial<StateMachineConfig>): TradingStateMachine {
    if (!stateMachine) {
        stateMachine = new TradingStateMachine(config);
    }
    return stateMachine;
}

/**
 * Reset state machine (for testing)
 */
export function resetStateMachine(): void {
    stateMachine = null;
}

export { TradingStateMachine };

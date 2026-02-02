// Shared Trading State (Module-Level Singleton)
// This state persists across API calls within the same serverless instance lifetime.
// For true persistence across deployments, use Vercel KV or a database.

export interface TradingState {
    pnl: number;
    risk_consumed: number;
    max_drawdown: number;
    regime: string;
    tsd_count: number;
    paper_mode: boolean;
    initial_capital: number;
    kill_switch: boolean;
    current_symbol: string;
    positions: Array<{ symbol: string; side: string; entry: number; current: number; qty: number; pnl: number }>;
    planned_trades: Array<{ symbol: string; side: string; entry: number; target: string; stop: string; current?: number }>;
    watchlist: string[];
    logs: string[];
    equity_history: Array<{ time: string; equity: number }>;
}

const initialState: TradingState = {
    pnl: 0,
    risk_consumed: 0,
    max_drawdown: 1.5,
    regime: "REGIME_A",
    tsd_count: 0,
    paper_mode: true,
    initial_capital: 100000,
    kill_switch: false,
    current_symbol: "MULTI",
    positions: [],
    planned_trades: [],
    watchlist: ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "LT", "AXISBANK", "BHARTIARTL", "ITC"],
    logs: ["[SYSTEM] AG_TRADER Vercel Engine initialized."],
    equity_history: [{ time: new Date().toLocaleTimeString(), equity: 100000 }]
};

// Global state reference
let state: TradingState = { ...initialState };

export function getState(): TradingState {
    return state;
}

export function updateState(partial: Partial<TradingState>) {
    state = { ...state, ...partial };
}

export function resetState() {
    state = { ...initialState };
}

export function addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    state.logs = [`[${timestamp}] ${message}`, ...state.logs.slice(0, 49)];
}

export function updateEquity() {
    const equity = state.initial_capital + state.pnl;
    state.equity_history = [
        ...state.equity_history.slice(-99),
        { time: new Date().toLocaleTimeString(), equity }
    ];
}

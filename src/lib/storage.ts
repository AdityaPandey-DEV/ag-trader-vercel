// Storage Layer for Algo Trader
// Provides persistence for trading state, historical data, and session info
// Uses file-based storage for development, can be swapped for Vercel KV in production

import * as fs from 'fs';
import * as path from 'path';
import { TradingState } from './state';
import { TSDEngineState } from './regimeEngine';
import { OHLCV } from './indicators';

// Storage directory (use tmp in serverless, or a persistent path locally)
const STORAGE_DIR = process.env.STORAGE_DIR || '/tmp/algo-trader';

/**
 * Ensure storage directory exists
 */
function ensureStorageDir(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

/**
 * Get storage file path
 */
function getFilePath(filename: string): string {
    ensureStorageDir();
    return path.join(STORAGE_DIR, filename);
}

// ============================================
// Trading State Persistence
// ============================================

const STATE_FILE = 'trading_state.json';

/**
 * Save trading state to storage
 */
export function saveTradingState(state: TradingState): boolean {
    try {
        const filePath = getFilePath(STATE_FILE);
        const data = {
            ...state,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save trading state:', error);
        return false;
    }
}

/**
 * Load trading state from storage
 */
export function loadTradingState(): TradingState | null {
    try {
        const filePath = getFilePath(STATE_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Check if saved state is from today (reset for new day)
        const savedDate = new Date(data.savedAt);
        const today = new Date();
        if (savedDate.toDateString() !== today.toDateString()) {
            console.log('[STORAGE] Saved state is from previous day, returning null');
            return null;
        }

        return data as TradingState;
    } catch (error) {
        console.error('Failed to load trading state:', error);
        return null;
    }
}

// ============================================
// Regime / TSD State Persistence
// ============================================

const REGIME_FILE = 'regime_state.json';

/**
 * Save regime engine state
 */
export function saveRegimeState(state: TSDEngineState): boolean {
    try {
        const filePath = getFilePath(REGIME_FILE);
        const data = {
            ...state,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save regime state:', error);
        return false;
    }
}

/**
 * Load regime engine state
 */
export function loadRegimeState(): TSDEngineState | null {
    try {
        const filePath = getFilePath(REGIME_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Convert date strings back to Date objects
        return {
            ...data,
            lastTSDDate: data.lastTSDDate ? new Date(data.lastTSDDate) : null,
            history: data.history?.map((h: any) => ({
                ...h,
                date: new Date(h.date)
            })) || []
        };
    } catch (error) {
        console.error('Failed to load regime state:', error);
        return null;
    }
}

// ============================================
// Historical OHLCV Data Storage
// ============================================

const HISTORY_FILE = 'historical_data.json';
const MAX_STORED_CANDLES = 500; // Store 500 candles per symbol

interface StoredHistoricalData {
    [symbol: string]: OHLCV[];
}

/**
 * Save historical OHLCV data
 */
export function saveHistoricalData(data: Record<string, OHLCV[]>): boolean {
    try {
        const filePath = getFilePath(HISTORY_FILE);

        // Trim to max candles per symbol
        const trimmedData: StoredHistoricalData = {};
        for (const [symbol, candles] of Object.entries(data)) {
            trimmedData[symbol] = candles.slice(-MAX_STORED_CANDLES);
        }

        fs.writeFileSync(filePath, JSON.stringify({
            data: trimmedData,
            savedAt: new Date().toISOString()
        }, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save historical data:', error);
        return false;
    }
}

/**
 * Load historical OHLCV data
 */
export function loadHistoricalData(): Record<string, OHLCV[]> | null {
    try {
        const filePath = getFilePath(HISTORY_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const stored = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Convert timestamps back to Date objects
        const data: Record<string, OHLCV[]> = {};
        for (const [symbol, candles] of Object.entries(stored.data as StoredHistoricalData)) {
            data[symbol] = candles.map(c => ({
                ...c,
                timestamp: c.timestamp ? new Date(c.timestamp) : undefined
            }));
        }

        return data;
    } catch (error) {
        console.error('Failed to load historical data:', error);
        return null;
    }
}

/**
 * Append new candles to historical data
 */
export function appendHistoricalData(newData: Record<string, OHLCV>): boolean {
    try {
        const existingData = loadHistoricalData() || {};

        for (const [symbol, candle] of Object.entries(newData)) {
            if (!existingData[symbol]) {
                existingData[symbol] = [];
            }
            existingData[symbol].push(candle);

            // Trim if exceeds max
            if (existingData[symbol].length > MAX_STORED_CANDLES) {
                existingData[symbol] = existingData[symbol].slice(-MAX_STORED_CANDLES);
            }
        }

        return saveHistoricalData(existingData);
    } catch (error) {
        console.error('Failed to append historical data:', error);
        return false;
    }
}

// ============================================
// Session Management
// ============================================

const SESSION_FILE = 'session_info.json';

interface SessionInfo {
    startTime: string;
    lastActive: string;
    tickCount: number;
    tradesExecuted: number;
    totalPnL: number;
}

/**
 * Save session info
 */
export function saveSessionInfo(info: Partial<SessionInfo>): boolean {
    try {
        const filePath = getFilePath(SESSION_FILE);

        let existing: SessionInfo = {
            startTime: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            tickCount: 0,
            tradesExecuted: 0,
            totalPnL: 0
        };

        if (fs.existsSync(filePath)) {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }

        const updated = {
            ...existing,
            ...info,
            lastActive: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save session info:', error);
        return false;
    }
}

/**
 * Load session info
 */
export function loadSessionInfo(): SessionInfo | null {
    try {
        const filePath = getFilePath(SESSION_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        console.error('Failed to load session info:', error);
        return null;
    }
}

/**
 * Increment tick count
 */
export function incrementTickCount(): number {
    const session = loadSessionInfo() || {
        startTime: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        tickCount: 0,
        tradesExecuted: 0,
        totalPnL: 0
    };

    session.tickCount += 1;
    saveSessionInfo(session);

    return session.tickCount;
}

// ============================================
// Daily Reset
// ============================================

/**
 * Check if we need to reset for a new trading day
 */
export function checkDailyReset(): boolean {
    const session = loadSessionInfo();
    if (!session) {
        return true; // First run, need initialization
    }

    const lastActive = new Date(session.lastActive);
    const today = new Date();

    // Reset if last active was a different day
    return lastActive.toDateString() !== today.toDateString();
}

/**
 * Perform daily reset
 */
export function performDailyReset(): void {
    console.log('[STORAGE] Performing daily reset');

    // Clear trading state (keeps regime state for trend continuity)
    const stateFile = getFilePath(STATE_FILE);
    if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
    }

    // Reset session info
    saveSessionInfo({
        startTime: new Date().toISOString(),
        tickCount: 0,
        tradesExecuted: 0,
        totalPnL: 0
    });

    // Note: We keep historical data and regime state for continuity
}

// ============================================
// Storage Status
// ============================================

/**
 * Get storage status
 */
export function getStorageStatus(): {
    available: boolean;
    tradingStateExists: boolean;
    regimeStateExists: boolean;
    historicalDataExists: boolean;
    sessionExists: boolean;
} {
    return {
        available: true,
        tradingStateExists: fs.existsSync(getFilePath(STATE_FILE)),
        regimeStateExists: fs.existsSync(getFilePath(REGIME_FILE)),
        historicalDataExists: fs.existsSync(getFilePath(HISTORY_FILE)),
        sessionExists: fs.existsSync(getFilePath(SESSION_FILE))
    };
}

/**
 * Clear all storage (for testing/reset)
 */
export function clearAllStorage(): boolean {
    try {
        const files = [STATE_FILE, REGIME_FILE, HISTORY_FILE, SESSION_FILE];
        for (const file of files) {
            const filePath = getFilePath(file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        return true;
    } catch (error) {
        console.error('Failed to clear storage:', error);
        return false;
    }
}

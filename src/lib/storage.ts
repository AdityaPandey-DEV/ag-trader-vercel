// Storage Layer for Algo Trader
// Provides persistence for trading state, historical data, and session info
// Uses Redis (primary) with File System fallback (local dev only)

import * as fs from 'fs';
import * as path from 'path';
import { TradingState } from './state';
import { TSDEngineState } from './regimeEngine';
import { OHLCV } from './indicators';
import { setValue, getValue, deleteKey } from './redis';

// Storage directory (fallback for local dev)
const STORAGE_DIR = process.env.STORAGE_DIR || '/tmp/algo-trader';

/**
 * Ensure storage directory exists (for fallback)
 */
function ensureStorageDir(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
        try {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
        } catch (e) {
            console.error('Failed to create storage dir:', e);
        }
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

const STATE_KEY = 'algo_trader:trading_state';
const STATE_FILE = 'trading_state.json';

/**
 * Save trading state to storage
 */
export async function saveTradingState(state: TradingState): Promise<boolean> {
    const data = {
        ...state,
        savedAt: new Date().toISOString()
    };

    // 1. Try Redis
    const redisSuccess = await setValue(STATE_KEY, data);
    if (redisSuccess) return true;

    // 2. Fallback to File
    try {
        const filePath = getFilePath(STATE_FILE);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save trading state (File fallback):', error);
        return false;
    }
}

/**
 * Load trading state from storage
 */
export async function loadTradingState(): Promise<TradingState | null> {
    // 1. Try Redis
    const redisData = await getValue<any>(STATE_KEY);
    if (redisData) {
        // Check date
        const savedDate = new Date(redisData.savedAt);
        const today = new Date();
        if (savedDate.toDateString() === today.toDateString()) {
            return redisData as TradingState;
        } else {
            console.log('[STORAGE] Redis state is from previous day, ignoring');
        }
    }

    // 2. Fallback to File
    try {
        const filePath = getFilePath(STATE_FILE);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const savedDate = new Date(data.savedAt);
        const today = new Date();
        if (savedDate.toDateString() !== today.toDateString()) {
            return null;
        }

        return data as TradingState;
    } catch (error) {
        return null;
    }
}

// ============================================
// Regime / TSD State Persistence
// ============================================

const REGIME_KEY = 'algo_trader:regime_state';
const REGIME_FILE = 'regime_state.json';

/**
 * Save regime engine state
 */
export async function saveRegimeState(state: TSDEngineState): Promise<boolean> {
    const data = {
        ...state,
        savedAt: new Date().toISOString()
    };

    const redisSuccess = await setValue(REGIME_KEY, data);
    if (redisSuccess) return true;

    try {
        const filePath = getFilePath(REGIME_FILE);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Load regime engine state
 */
export async function loadRegimeState(): Promise<TSDEngineState | null> {
    const redisData = await getValue<any>(REGIME_KEY);
    let data = redisData;

    if (!data) {
        try {
            const filePath = getFilePath(REGIME_FILE);
            if (fs.existsSync(filePath)) {
                data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        } catch (e) { /* ignore */ }
    }

    if (data) {
        // Convert date strings
        return {
            ...data,
            lastTSDDate: data.lastTSDDate ? new Date(data.lastTSDDate) : null,
            history: data.history?.map((h: any) => ({
                ...h,
                date: new Date(h.date)
            })) || []
        };
    }
    return null;
}

// ============================================
// Historical OHLCV Data Storage
// ============================================

const HISTORY_KEY = 'algo_trader:historical_data';
const HISTORY_FILE = 'historical_data.json';
const MAX_STORED_CANDLES = 500;

interface StoredHistoricalData {
    [symbol: string]: OHLCV[];
}

/**
 * Save historical OHLCV data
 */
export async function saveHistoricalData(data: Record<string, OHLCV[]>): Promise<boolean> {
    // Trim
    const trimmedData: StoredHistoricalData = {};
    for (const [symbol, candles] of Object.entries(data)) {
        trimmedData[symbol] = candles.slice(-MAX_STORED_CANDLES);
    }

    const payload = {
        data: trimmedData,
        savedAt: new Date().toISOString()
    };

    const redisSuccess = await setValue(HISTORY_KEY, payload, 3600 * 24 * 7); // 7 days retention
    if (redisSuccess) return true;

    try {
        const filePath = getFilePath(HISTORY_FILE);
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Load historical OHLCV data
 */
export async function loadHistoricalData(): Promise<Record<string, OHLCV[]> | null> {
    const redisData = await getValue<any>(HISTORY_KEY);
    let stored = redisData;

    if (!stored) {
        try {
            const filePath = getFilePath(HISTORY_FILE);
            if (fs.existsSync(filePath)) {
                stored = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        } catch (e) { /* ignore */ }
    }

    if (stored && stored.data) {
        const data: Record<string, OHLCV[]> = {};
        for (const [symbol, candles] of Object.entries(stored.data as StoredHistoricalData)) {
            data[symbol] = candles.map(c => ({
                ...c,
                timestamp: c.timestamp ? new Date(c.timestamp) : undefined
            }));
        }
        return data;
    }
    return null;
}

// ============================================
// Session Management
// ============================================

const SESSION_KEY = 'algo_trader:session_info';
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
export async function saveSessionInfo(info: Partial<SessionInfo>): Promise<boolean> {
    let existing: SessionInfo = {
        startTime: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        tickCount: 0,
        tradesExecuted: 0,
        totalPnL: 0
    };

    const current = await loadSessionInfo();
    if (current) {
        existing = current;
    }

    const updated = {
        ...existing,
        ...info,
        lastActive: new Date().toISOString()
    };

    const redisSuccess = await setValue(SESSION_KEY, updated);
    if (redisSuccess) return true;

    try {
        const filePath = getFilePath(SESSION_FILE);
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Load session info
 */
export async function loadSessionInfo(): Promise<SessionInfo | null> {
    const redisData = await getValue<SessionInfo>(SESSION_KEY);
    if (redisData) return redisData;

    try {
        const filePath = getFilePath(SESSION_FILE);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * Increment tick count
 */
export async function incrementTickCount(): Promise<number> {
    let session = await loadSessionInfo();
    if (!session) {
        session = {
            startTime: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            tickCount: 0,
            tradesExecuted: 0,
            totalPnL: 0
        };
    }

    session.tickCount += 1;
    await saveSessionInfo(session);

    return session.tickCount;
}

// ============================================
// Daily Reset
// ============================================

/**
 * Check if we need to reset for a new trading day
 */
export async function checkDailyReset(): Promise<boolean> {
    const session = await loadSessionInfo();
    if (!session) {
        return true;
    }

    const lastActive = new Date(session.lastActive);
    const today = new Date();

    return lastActive.toDateString() !== today.toDateString();
}

/**
 * Perform daily reset
 */
export async function performDailyReset(): Promise<void> {
    console.log('[STORAGE] Performing daily reset');

    // Clear state in Redis
    await deleteKey(STATE_KEY);

    // Clear state file
    const stateFile = getFilePath(STATE_FILE);
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    // Reset session
    await saveSessionInfo({
        startTime: new Date().toISOString(),
        tickCount: 0,
        tradesExecuted: 0,
        totalPnL: 0
    });
}

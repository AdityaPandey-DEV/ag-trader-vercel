/**
 * Upstash Redis Client for token persistence
 * Vercel's Upstash integration sets these env vars automatically:
 * - KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN
 * - Or: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from '@upstash/redis';

// Create Redis client (lazy initialization)
let redis: Redis | null = null;
let redisInitAttempted = false;

function getRedis(): Redis | null {
    if (redis) return redis;
    if (redisInitAttempted) return null;

    redisInitAttempted = true;

    // Check for all possible Vercel/Upstash env var names
    const url = process.env.KV_REST_API_URL
        || process.env.UPSTASH_REDIS_REST_URL
        || process.env.REDIS_REST_URL;

    const token = process.env.KV_REST_API_TOKEN
        || process.env.UPSTASH_REDIS_REST_TOKEN
        || process.env.REDIS_REST_TOKEN;

    console.log('🔍 Redis config check:', {
        KV_REST_API_URL: process.env.KV_REST_API_URL ? '✅' : '❌',
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? '✅' : '❌',
        KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? '✅' : '❌',
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? '✅' : '❌'
    });

    if (!url || !token) {
        console.warn('⚠️ Redis REST API not configured. Token will not persist.');
        console.warn('💡 Go to Vercel Dashboard → Storage → Click on your Redis → Settings → Copy REST API credentials');
        return null;
    }

    console.log('🔗 Connecting to Redis:', url.substring(0, 30) + '...');
    redis = new Redis({ url, token });
    return redis;
}

// Token keys
const UPSTOX_TOKEN_KEY = 'upstox:access_token';
const UPSTOX_EXPIRY_KEY = 'upstox:token_expiry';

/**
 * Save token to Redis with 24-hour expiry
 * @param token - The token to save
 * @param key - Optional custom key (defaults to Upstox token)
 */
export async function saveToken(token: string, key: string = UPSTOX_TOKEN_KEY): Promise<boolean> {
    const client = getRedis();
    if (!client) return false;

    try {
        // Calculate seconds until midnight IST (Internet Standard Time UTC+5:30)
        // India is UTC+5:30.
        // Current UTC time
        const now = new Date();
        const currentUtc = now.getTime();

        // Target: Next midnight IST
        // 1. Get current time in IST
        const istOffset = 5.5 * 60 * 60 * 1000;
        const currentIstTime = new Date(currentUtc + istOffset);

        // 2. Set to next midnight (User's local time might be different, but we enforce IST midnight for Indian market)
        const nextMidnightIst = new Date(currentIstTime);
        nextMidnightIst.setUTCHours(24, 0, 0, 0); // Sets to 00:00:00 of next day

        // 3. Diff in milliseconds
        const timeUntilMidnight = nextMidnightIst.getTime() - currentIstTime.getTime();

        // 4. Convert to seconds for Redis (ensure at least 60s to avoid instant expiry issues)
        const ttlSeconds = Math.max(60, Math.floor(timeUntilMidnight / 1000));

        await client.set(key, token, { ex: ttlSeconds });
        await client.set(`${key}:expiry`, (Date.now() + timeUntilMidnight).toString(), { ex: ttlSeconds });
        console.log(`💾 Saved token to Redis: ${key} (Expires in ${(ttlSeconds / 3600).toFixed(2)}h at Midnight IST)`);
        return true;
    } catch (e) {
        console.error('Redis save error:', e);
        return false;
    }
}

/**
 * Load token from Redis
 * @param key - Optional custom key (defaults to Upstox token)
 */
export async function loadToken(key: string = UPSTOX_TOKEN_KEY): Promise<string | null> {
    const client = getRedis();
    if (!client) return null;

    try {
        const token = await client.get<string>(key);
        if (token) {
            console.log(`✅ Loaded token from Redis: ${key}`);
            return token;
        }
        return null;
    } catch (e) {
        console.error('Redis load error:', e);
        return null;
    }
}

/**
 * Check if token exists in Redis
 */
export async function hasToken(): Promise<boolean> {
    const client = getRedis();
    if (!client) return false;

    try {
        const exists = await client.exists(UPSTOX_TOKEN_KEY);
        return exists === 1;
    } catch (e) {
        console.error('Redis check error:', e);
        return false;
    }
}

/**
 * Clear token from Redis (logout)
 */
export async function clearToken(): Promise<void> {
    const client = getRedis();
    if (!client) return;

    try {
        await client.del(UPSTOX_TOKEN_KEY);
        await client.del(UPSTOX_EXPIRY_KEY);
        console.log('🗑️ Cleared Upstox token from Redis');
    } catch (e) {
        console.error('Redis clear error:', e);
    }
}

/**
 * Generic Save to Redis
 */
export async function setValue(key: string, value: any, ttlSeconds: number = 86400): Promise<boolean> {
    const client = getRedis();
    if (!client) return false;

    try {
        const stringVal = JSON.stringify(value);
        if (ttlSeconds > 0) {
            await client.set(key, stringVal, { ex: ttlSeconds });
        } else {
            await client.set(key, stringVal);
        }
        return true;
    } catch (e) {
        console.error(`Redis save error (${key}):`, e);
        return false;
    }
}

/**
 * Generic Load from Redis
 */
export async function getValue<T>(key: string): Promise<T | null> {
    const client = getRedis();
    if (!client) return null;

    try {
        const data = await client.get<string>(key);
        if (data) {
            // Upstash redis client might return object if it auto-parses? 
            // Usually returns string or object depending on config. 
            // Safest to handle both or assume standard behavior.
            // The @upstash/redis client typically returns the value as is if it's JSON?
            // Let's assume it handles JSON if stored as JSON/string because we control input.
            // Actually, if we stringify above, we might get object back if client auto-parses, or string.
            // Let's rely on type assertion or parsing if string.
            if (typeof data === 'string') {
                return JSON.parse(data);
            }
            return data as T;
        }
        return null;
    } catch (e) {
        console.error(`Redis load error (${key}):`, e);
        return null;
    }
}

/**
 * Generic Delete from Redis
 */
export async function deleteKey(key: string): Promise<boolean> {
    const client = getRedis();
    if (!client) return false;
    try {
        await client.del(key);
        return true;
    } catch (e) {
        console.error(`Redis delete error (${key}):`, e);
        return false;
    }
}

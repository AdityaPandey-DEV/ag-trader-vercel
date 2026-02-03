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
        const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
        await client.set(key, token, { ex: 86400 }); // 24h TTL
        await client.set(`${key}:expiry`, expiry.toString(), { ex: 86400 });
        console.log(`💾 Saved token to Redis: ${key}`);
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

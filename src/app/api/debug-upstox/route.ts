
import { NextResponse } from 'next/server';
import { loadToken as loadTokenFromRedis } from '@/lib/redis';

export async function GET() {
    const results: Record<string, any> = {
        timestamp: new Date().toISOString(),
        steps: []
    };

    // Step 1: Check Redis token
    let redisToken: string | null = null;
    try {
        redisToken = await loadTokenFromRedis();
        results.steps.push({
            step: 1,
            name: 'Load token from Redis',
            success: !!redisToken,
            tokenPreview: redisToken ? redisToken.substring(0, 20) + '...' : null
        });
    } catch (e) {
        results.steps.push({
            step: 1,
            name: 'Load token from Redis',
            success: false,
            error: String(e)
        });
    }

    // Step 2: Test Upstox API with the token
    if (redisToken) {
        try {
            const testSymbol = 'NSE_EQ|RELIANCE';
            const url = `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${testSymbol}`;

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${redisToken}`,
                    'Accept': 'application/json'
                }
            });

            const json = await response.json();

            results.steps.push({
                step: 2,
                name: 'Test Upstox LTP API',
                httpStatus: response.status,
                success: response.ok,
                response: json
            });

            if (response.ok && json.data) {
                const relianceData = json.data['NSE_EQ|RELIANCE'];
                results.steps.push({
                    step: 3,
                    name: 'Parse RELIANCE price',
                    success: !!relianceData,
                    price: relianceData?.last_price || null
                });
            }
        } catch (e) {
            results.steps.push({
                step: 2,
                name: 'Test Upstox LTP API',
                success: false,
                error: String(e)
            });
        }
    }

    // Step 3: Check environment variables
    results.environment = {
        UPSTOX_API_KEY: process.env.UPSTOX_API_KEY ? '✅ Set (' + process.env.UPSTOX_API_KEY.substring(0, 8) + '...)' : '❌ Not set',
        UPSTOX_API_SECRET: process.env.UPSTOX_API_SECRET ? '✅ Set' : '❌ Not set',
        UPSTOX_REDIRECT_URI: process.env.UPSTOX_REDIRECT_URI || 'Using default'
    };

    return NextResponse.json(results, { status: 200 });
}

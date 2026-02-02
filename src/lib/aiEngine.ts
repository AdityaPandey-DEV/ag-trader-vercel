// AI Integration Module for Algo Trader
// Uses Google Gemini for chart analysis and trend confirmation
// AI acts as an assistant - cannot override system rules

import { addLog } from './state';
import { MarketRegime, getRegimePermissions } from './regimeEngine';
import { OHLCV } from './indicators';

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Check if AI is configured
 */
export function isAIConfigured(): boolean {
    return !!GEMINI_API_KEY;
}

/**
 * AI Trend Classification
 */
export type AITrendClassification = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCERTAIN';

/**
 * AI Analysis Result
 */
export interface AIAnalysisResult {
    success: boolean;
    symbol: string;
    trend: AITrendClassification;
    confidence: number;           // 0-100
    keyLevels: {
        support?: number;
        resistance?: number;
    };
    reasoning: string;
    analysisTime: Date;
    rawResponse?: string;
}

/**
 * Conflict Resolution Result
 */
export interface ConflictResolution {
    systemSignal: 'LONG' | 'SHORT' | null;
    aiTrend: AITrendClassification;
    conflict: boolean;
    resolution: 'PROCEED' | 'SKIP' | 'REDUCE_SIZE';
    reason: string;
}

/**
 * Generate a text description of OHLCV data for AI analysis
 * (Alternative to sending actual images)
 */
function generateChartDescription(candles: OHLCV[], symbol: string): string {
    if (candles.length === 0) {
        return `No data available for ${symbol}`;
    }

    const recent = candles.slice(-20); // Last 20 candles
    const closes = recent.map(c => c.close);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    const volumes = recent.map(c => c.volume);

    const currentPrice = closes[closes.length - 1];
    const openPrice = recent[0].open;
    const highPrice = Math.max(...highs);
    const lowPrice = Math.min(...lows);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Calculate trend
    const priceChange = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
    const range = ((highPrice - lowPrice) / lowPrice * 100).toFixed(2);

    // Detect patterns
    const lastCandle = recent[recent.length - 1];
    const prevCandle = recent[recent.length - 2];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isBearishCandle = lastCandle.close < lastCandle.open;

    // Moving averages (simple)
    const sma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const sma20 = closes.reduce((a, b) => a + b, 0) / closes.length;

    return `
Stock: ${symbol}
Analysis Period: Last 20 candles

Price Action:
- Current Price: ₹${currentPrice.toFixed(2)}
- Period Open: ₹${openPrice.toFixed(2)}
- Period High: ₹${highPrice.toFixed(2)}
- Period Low: ₹${lowPrice.toFixed(2)}
- Price Change: ${priceChange}%
- Range: ${range}%

Moving Averages:
- SMA(5): ₹${sma5.toFixed(2)}
- SMA(10): ₹${sma10.toFixed(2)}
- SMA(20): ₹${sma20.toFixed(2)}

Latest Candle:
- Type: ${isBullishCandle ? 'BULLISH (Green)' : isBearishCandle ? 'BEARISH (Red)' : 'DOJI'}
- Body Size: ${Math.abs(lastCandle.close - lastCandle.open).toFixed(2)}
- Volume: ${lastCandle.volume} (Avg: ${avgVolume.toFixed(0)})

Position Relative to MAs:
- Price vs SMA5: ${currentPrice > sma5 ? 'ABOVE' : 'BELOW'}
- Price vs SMA10: ${currentPrice > sma10 ? 'ABOVE' : 'BELOW'}
- Price vs SMA20: ${currentPrice > sma20 ? 'ABOVE' : 'BELOW'}
- SMA5 vs SMA10: ${sma5 > sma10 ? 'BULLISH CROSSOVER' : 'BEARISH CROSSOVER'}
`.trim();
}

/**
 * The system prompt for Gemini
 */
const SYSTEM_PROMPT = `You are a technical analysis AI for intraday trading. Analyze the given stock data and provide:

1. TREND: One of BULLISH, BEARISH, NEUTRAL, or UNCERTAIN
2. CONFIDENCE: A number from 0-100 indicating how confident you are
3. SUPPORT: A suggested support level (or null if unclear)
4. RESISTANCE: A suggested resistance level (or null if unclear)
5. REASONING: A brief explanation (max 50 words)

Respond ONLY in this exact JSON format:
{
  "trend": "BULLISH|BEARISH|NEUTRAL|UNCERTAIN",
  "confidence": 0-100,
  "support": number|null,
  "resistance": number|null,
  "reasoning": "string"
}

Rules:
- Be conservative. If unsure, use UNCERTAIN with low confidence.
- For intraday, focus on recent price action, not long-term trends.
- High volume with price movement is more significant.
- Candlestick patterns matter: doji, hammer, engulfing, etc.
`;

/**
 * Analyze chart data using Gemini AI
 */
export async function analyzeChart(
    symbol: string,
    candles: OHLCV[]
): Promise<AIAnalysisResult> {
    const fallbackResult: AIAnalysisResult = {
        success: false,
        symbol,
        trend: 'UNCERTAIN',
        confidence: 0,
        keyLevels: {},
        reasoning: 'AI analysis unavailable',
        analysisTime: new Date()
    };

    if (!isAIConfigured()) {
        return { ...fallbackResult, reasoning: 'Gemini API not configured' };
    }

    if (candles.length < 5) {
        return { ...fallbackResult, reasoning: 'Insufficient data for analysis' };
    }

    try {
        const chartDescription = generateChartDescription(candles, symbol);

        const response = await fetch(
            `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `${SYSTEM_PROMPT}\n\nAnalyze this stock:\n\n${chartDescription}`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 256
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error('Gemini API error:', error);
            return { ...fallbackResult, reasoning: `API error: ${response.status}` };
        }

        const data = await response.json();

        // Extract text from Gemini response
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            return { ...fallbackResult, reasoning: 'Empty AI response' };
        }

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { ...fallbackResult, reasoning: 'Failed to parse AI response', rawResponse: text };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate and normalize
        const validTrends: AITrendClassification[] = ['BULLISH', 'BEARISH', 'NEUTRAL', 'UNCERTAIN'];
        const trend = validTrends.includes(parsed.trend) ? parsed.trend : 'UNCERTAIN';
        const confidence = Math.min(100, Math.max(0, parseInt(parsed.confidence) || 0));

        const result: AIAnalysisResult = {
            success: true,
            symbol,
            trend,
            confidence,
            keyLevels: {
                support: parsed.support || undefined,
                resistance: parsed.resistance || undefined
            },
            reasoning: parsed.reasoning || 'No reasoning provided',
            analysisTime: new Date(),
            rawResponse: text
        };

        addLog(`🤖 AI: ${symbol} → ${trend} (${confidence}%)`);
        return result;

    } catch (error) {
        console.error('AI analysis error:', error);
        return { ...fallbackResult, reasoning: `Error: ${String(error)}` };
    }
}

/**
 * Resolve conflicts between system signals and AI analysis
 * 
 * Rules:
 * 1. AI cannot override system risk controls
 * 2. AI can add caution to trades (reduce size)
 * 3. High confidence AI disagreement skips trade
 * 4. Low confidence AI is ignored
 */
export function resolveConflict(
    systemSignal: 'LONG' | 'SHORT' | null,
    aiResult: AIAnalysisResult,
    regime: MarketRegime
): ConflictResolution {
    const resolution: ConflictResolution = {
        systemSignal,
        aiTrend: aiResult.trend,
        conflict: false,
        resolution: 'PROCEED',
        reason: 'No conflict detected'
    };

    // If no system signal, nothing to conflict with
    if (!systemSignal) {
        return { ...resolution, reason: 'No system signal' };
    }

    // AI not available or uncertain
    if (!aiResult.success || aiResult.trend === 'UNCERTAIN') {
        return { ...resolution, reason: 'AI uncertain - proceeding with system signal' };
    }

    // Low confidence AI - ignore
    if (aiResult.confidence < 40) {
        return { ...resolution, reason: `AI confidence too low (${aiResult.confidence}%) - proceeding` };
    }

    // Check for conflict
    const isLongSignal = systemSignal === 'LONG';
    const isShortSignal = systemSignal === 'SHORT';
    const isBullishAI = aiResult.trend === 'BULLISH';
    const isBearishAI = aiResult.trend === 'BEARISH';
    const isNeutralAI = aiResult.trend === 'NEUTRAL';

    // Agreement
    if ((isLongSignal && isBullishAI) || (isShortSignal && isBearishAI)) {
        return {
            ...resolution,
            reason: `AI confirms ${systemSignal} signal (${aiResult.confidence}%)`
        };
    }

    // Neutral AI - reduce size but proceed
    if (isNeutralAI) {
        return {
            ...resolution,
            conflict: true,
            resolution: 'REDUCE_SIZE',
            reason: 'AI neutral - reducing position size'
        };
    }

    // Direct conflict
    if ((isLongSignal && isBearishAI) || (isShortSignal && isBullishAI)) {
        resolution.conflict = true;

        // High confidence disagreement - skip
        if (aiResult.confidence >= 70) {
            return {
                ...resolution,
                resolution: 'SKIP',
                reason: `AI strongly disagrees (${aiResult.trend} ${aiResult.confidence}%) - skipping trade`
            };
        }

        // Moderate confidence - reduce size
        return {
            ...resolution,
            resolution: 'REDUCE_SIZE',
            reason: `AI disagrees (${aiResult.trend} ${aiResult.confidence}%) - reducing size`
        };
    }

    return resolution;
}

/**
 * Get AI analysis summary for dashboard
 */
export function getAIAnalysisSummary(results: AIAnalysisResult[]): {
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    avgConfidence: number;
    lastAnalysis: Date | null;
} {
    if (results.length === 0) {
        return {
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0,
            avgConfidence: 0,
            lastAnalysis: null
        };
    }

    const bullishCount = results.filter(r => r.trend === 'BULLISH').length;
    const bearishCount = results.filter(r => r.trend === 'BEARISH').length;
    const neutralCount = results.filter(r => r.trend === 'NEUTRAL' || r.trend === 'UNCERTAIN').length;

    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const lastAnalysis = results[results.length - 1].analysisTime;

    return { bullishCount, bearishCount, neutralCount, avgConfidence, lastAnalysis };
}

/**
 * Batch analyze multiple symbols
 */
export async function batchAnalyze(
    symbolData: Record<string, OHLCV[]>,
    maxConcurrent: number = 3
): Promise<Record<string, AIAnalysisResult>> {
    const results: Record<string, AIAnalysisResult> = {};
    const symbols = Object.keys(symbolData);

    // Process in batches to avoid rate limiting
    for (let i = 0; i < symbols.length; i += maxConcurrent) {
        const batch = symbols.slice(i, i + maxConcurrent);
        const batchPromises = batch.map(symbol =>
            analyzeChart(symbol, symbolData[symbol])
        );

        const batchResults = await Promise.all(batchPromises);

        for (let j = 0; j < batch.length; j++) {
            results[batch[j]] = batchResults[j];
        }

        // Small delay between batches
        if (i + maxConcurrent < symbols.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return results;
}

/**
 * AI analysis cache to avoid repeated calls
 */
const analysisCache: Map<string, { result: AIAnalysisResult; expiry: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached analysis or perform new one
 */
export async function getCachedAnalysis(
    symbol: string,
    candles: OHLCV[]
): Promise<AIAnalysisResult> {
    const cacheKey = `${symbol}_${candles.length}`;
    const cached = analysisCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
        return cached.result;
    }

    const result = await analyzeChart(symbol, candles);

    analysisCache.set(cacheKey, {
        result,
        expiry: Date.now() + CACHE_TTL
    });

    return result;
}

/**
 * Clear analysis cache
 */
export function clearAICache(): void {
    analysisCache.clear();
}

/**
 * Yahoo Finance API Integration using yahoo-finance2 package
 * Provides reliable market data when Upstox/Dhan are unavailable.
 */

import yahooFinance from 'yahoo-finance2';

// Type for Yahoo Finance quote response (subset of fields we use)
interface YahooFinanceQuote {
    symbol: string;
    regularMarketPrice?: number;
    regularMarketOpen?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketPreviousClose?: number;
    regularMarketChange?: number;
    regularMarketChangePercent?: number;
    regularMarketVolume?: number;
}

export interface YahooQuote {
    symbol: string;
    lastPrice: number;
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
    changePercent: number;
    volume: number;
}

// Map NSE symbols to Yahoo Finance format (e.g., RELIANCE -> RELIANCE.NS)
function toYahooSymbol(symbol: string): string {
    return `${symbol}.NS`;
}

/**
 * Fetch quotes from Yahoo Finance for a list of NSE symbols
 */
export async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, YahooQuote>> {
    if (symbols.length === 0) return {};

    const result: Record<string, YahooQuote> = {};

    try {
        const yahooSymbols = symbols.map(toYahooSymbol);

        // Use quote for each symbol
        const quotePromises = yahooSymbols.map(async (yahooSymbol): Promise<YahooFinanceQuote | null> => {
            try {
                // yahoo-finance2 v3 uses default export directly
                const quote = await yahooFinance.quote(yahooSymbol) as YahooFinanceQuote;
                return quote;
            } catch (e) {
                console.error(`Yahoo Finance error for ${yahooSymbol}:`, e);
                return null;
            }
        });

        const quotes = await Promise.all(quotePromises);

        for (const quote of quotes) {
            if (!quote || !quote.symbol) continue;

            // Extract the original NSE symbol from Yahoo format
            const nseSymbol = quote.symbol.replace('.NS', '');

            result[nseSymbol] = {
                symbol: nseSymbol,
                lastPrice: quote.regularMarketPrice || 0,
                open: quote.regularMarketOpen || 0,
                high: quote.regularMarketDayHigh || 0,
                low: quote.regularMarketDayLow || 0,
                close: quote.regularMarketPreviousClose || 0,
                change: quote.regularMarketChange || 0,
                changePercent: quote.regularMarketChangePercent || 0,
                volume: quote.regularMarketVolume || 0
            };
        }

        console.log(`✅ Yahoo Finance: Fetched ${Object.keys(result).length}/${symbols.length} quotes`);
        return result;
    } catch (error) {
        console.error('Yahoo Finance fetch error:', error);
        return {};
    }
}

/**
 * Transform Yahoo quotes to the standard OHLCV format used by the trading engine
 */
export function transformYahooToOHLCV(yahooQuotes: Record<string, YahooQuote>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [symbol, quote] of Object.entries(yahooQuotes)) {
        result[symbol] = {
            symbol,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            close: quote.lastPrice, // Use lastPrice as current close
            volume: quote.volume,
            lastPrice: quote.lastPrice,
            change: quote.change,
            changePercent: quote.changePercent
        };
    }

    return result;
}

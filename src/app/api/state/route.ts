import { NextResponse } from 'next/server';
import { getState, updateState, updateEquity, updateBrokerBalance } from '@/lib/state';
import { getMarketInfo } from '@/lib/marketHours';
import { isDhanConfigured, getBalance as getDhanBalance } from '@/lib/dhanApi';
import { fetchUpstoxFullQuotes, isUpstoxAuthenticatedAsync, getUpstoxBalance } from '@/lib/upstoxApi';
import { initRiskEngine } from '@/lib/riskEngine';

// Cache for balance to avoid too many API calls
let cachedDhanBalance = 0;
let cachedUpstoxBalance = 0;
let lastBalanceFetch = 0;
const BALANCE_CACHE_MS = 30000; // 30 seconds cache

export async function GET() {
    const state = getState();
    const marketInfo = getMarketInfo();
    const dhanConfigured = isDhanConfigured();
    const hasUpstoxToken = await isUpstoxAuthenticatedAsync();

    // Determine data source indicator
    let dataSource = 'MOCK';

    if (hasUpstoxToken) {
        dataSource = state.broker_mode === 'PAPER' ? 'UPSTOX_PAPER' : 'UPSTOX_LIVE';
    } else if (dhanConfigured) {
        dataSource = state.broker_mode === 'PAPER' ? 'PAPER' : 'DHAN_LIVE';
    }

    // Fetch live broker balance based on broker_mode
    let brokerBalance = state.broker_balance;
    let effectiveCapital = state.initial_capital;
    const now = Date.now();

    // Only fetch if cache expired
    if (now - lastBalanceFetch > BALANCE_CACHE_MS) {
        lastBalanceFetch = now;

        // DHAN Balance
        if (state.broker_mode === 'DHAN' && dhanConfigured) {
            try {
                const balanceResult = await getDhanBalance();
                const realBalance = balanceResult?.available ?? null;

                if (realBalance !== null) {
                    cachedDhanBalance = realBalance;
                    brokerBalance = realBalance;
                    effectiveCapital = realBalance;
                    updateBrokerBalance(realBalance);
                    initRiskEngine(realBalance);
                    console.log(`💰 Dhan Balance: ₹${realBalance.toLocaleString()}`);
                }
            } catch (e) {
                console.error('Dhan balance fetch error:', e);
                if (cachedDhanBalance > 0) {
                    brokerBalance = cachedDhanBalance;
                    effectiveCapital = cachedDhanBalance;
                }
            }
        }

        // UPSTOX Balance
        if (state.broker_mode === 'UPSTOX' && hasUpstoxToken) {
            try {
                const realBalance = await getUpstoxBalance();

                if (realBalance !== null) {
                    cachedUpstoxBalance = realBalance;
                    brokerBalance = realBalance;
                    effectiveCapital = realBalance;
                    updateBrokerBalance(realBalance);
                    initRiskEngine(realBalance);
                    console.log(`💰 Upstox Balance: ₹${realBalance.toLocaleString()}`);
                }
            } catch (e) {
                console.error('Upstox balance fetch error:', e);
                if (cachedUpstoxBalance > 0) {
                    brokerBalance = cachedUpstoxBalance;
                    effectiveCapital = cachedUpstoxBalance;
                }
            }
        }
    } else {
        // Use cached balance
        if (state.broker_mode === 'DHAN' && cachedDhanBalance > 0) {
            brokerBalance = cachedDhanBalance;
            effectiveCapital = cachedDhanBalance;
        } else if (state.broker_mode === 'UPSTOX' && cachedUpstoxBalance > 0) {
            brokerBalance = cachedUpstoxBalance;
            effectiveCapital = cachedUpstoxBalance;
        }
    }

    // NEW: Fetch live quotes using UPSTOX (User's preferred data source)
    let quotes: Record<string, any> = {};

    if (state.watchlist.length > 0) {
        try {
            const upstoxQuotes = await fetchUpstoxFullQuotes(state.watchlist);

            Object.keys(upstoxQuotes).forEach(sym => {
                const q = upstoxQuotes[sym];
                if (q) {
                    quotes[sym] = {
                        close: q.lastPrice,
                        change: q.change,
                        changePercent: (q.change / (q.lastPrice - q.change)) * 100
                    };
                }
            });
        } catch (e) {
            console.error('Upstox quote fetch failed:', e);
        }
    }

    // Update equity on each poll
    updateEquity();

    return NextResponse.json({
        ...state,
        initial_capital: effectiveCapital,
        market_status: marketInfo.status,
        market_message: marketInfo.message,
        data_source: dataSource,
        broker_mode: state.broker_mode,
        broker_balance: brokerBalance,
        dhan_configured: dhanConfigured,
        has_upstox_token: hasUpstoxToken,
        quotes: quotes
    });
}

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

    // Fetch live broker balances (Parallel Execution)
    const now = Date.now();
    let shouldFetch = now - lastBalanceFetch > BALANCE_CACHE_MS;

    // Always fetch both if configured
    const promises: Promise<any>[] = [];

    // 1. Dhan Fetch
    if (dhanConfigured && shouldFetch) {
        promises.push(
            getDhanBalance().then(res => {
                if (res?.available !== undefined && res.available !== null) {
                    cachedDhanBalance = res.available;
                    console.log(`💰 Dhan Balance: ₹${res.available.toLocaleString()}`);
                }
            }).catch(e => console.error('Dhan fetch error:', e))
        );
    }

    // 2. Upstox Fetch
    if (hasUpstoxToken && shouldFetch) {
        promises.push(
            getUpstoxBalance().then(bal => {
                if (bal !== null) {
                    cachedUpstoxBalance = bal;
                    console.log(`💰 Upstox Balance: ₹${bal.toLocaleString()}`);
                }
            }).catch(e => console.error('Upstox fetch error:', e))
        );
    }

    // Wait for all fetches
    if (promises.length > 0) {
        await Promise.all(promises);
        lastBalanceFetch = now;
    }

    // Determine current active balance
    let brokerBalance = state.broker_balance;
    let effectiveCapital = state.initial_capital;

    if (state.broker_mode === 'DHAN' && cachedDhanBalance !== undefined) {
        brokerBalance = cachedDhanBalance;
        effectiveCapital = cachedDhanBalance;
        // Update state with latest real balance
        updateBrokerBalance(cachedDhanBalance);
        initRiskEngine(cachedDhanBalance);
    } else if (state.broker_mode === 'UPSTOX' && cachedUpstoxBalance !== undefined) {
        brokerBalance = cachedUpstoxBalance;
        effectiveCapital = cachedUpstoxBalance;
        updateBrokerBalance(cachedUpstoxBalance);
        initRiskEngine(cachedUpstoxBalance);
    } else if (state.broker_mode === 'PAPER') {
        // For PAPER, use stored state
        // brokerBalance is already state.broker_balance
        effectiveCapital = state.initial_capital;
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
        // Send ALL balances to frontend for instant switching
        // Send ALL balances to frontend for instant switching
        all_balances: {
            PAPER: 100000, // Default for paper trade
            DHAN: cachedDhanBalance,
            UPSTOX: cachedUpstoxBalance
        },
        dhan_configured: dhanConfigured,
        has_upstox_token: hasUpstoxToken,
        quotes: quotes
    });
}

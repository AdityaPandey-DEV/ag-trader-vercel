import { NextResponse } from 'next/server';
import { getState, updateState, addLog, updateEquity } from '@/lib/state';
import { generateMockData, getPriorData, updatePriorData, calculateLevels } from '@/lib/mockData';
import { calculatePlannedTrade } from '@/lib/strategy';
import { CONFIG } from '@/lib/config';

export async function POST() {
    const state = getState();

    // Don't run if kill switch is active
    if (state.kill_switch) {
        return NextResponse.json({ status: 'halted', message: 'Kill switch active' });
    }

    try {
        // 1. Generate mock market data
        const marketData = generateMockData(CONFIG.WATCHLIST);

        // 2. Calculate planned trades for each symbol
        const plannedTrades: any[] = [];

        for (const symbol of CONFIG.WATCHLIST) {
            const data = marketData[symbol];
            if (!data) continue;

            const priorData = getPriorData(symbol);
            const levels = calculateLevels(data);

            // Get potential entry levels
            const trades = calculatePlannedTrade(data, levels.support, levels.resistance);
            plannedTrades.push(...trades);
        }

        // 3. Update prior data for next tick
        updatePriorData(marketData);

        // 4. Simulate PnL movement (small random walk for demo)
        const pnlChange = (Math.random() - 0.5) * 200;
        const newPnl = state.pnl + pnlChange;
        const riskConsumed = Math.abs(newPnl) / state.initial_capital * 100;

        // 5. Update state
        updateState({
            pnl: Number(newPnl.toFixed(2)),
            risk_consumed: Number(riskConsumed.toFixed(4)),
            planned_trades: plannedTrades,
            watchlist: CONFIG.WATCHLIST,
            current_symbol: CONFIG.WATCHLIST[Math.floor(Math.random() * CONFIG.WATCHLIST.length)]
        });

        // 6. Update equity curve
        updateEquity();

        // 7. Log activity
        if (plannedTrades.length > 0) {
            const longCount = plannedTrades.filter(t => t.side === 'LONG').length;
            const shortCount = plannedTrades.filter(t => t.side === 'SHORT').length;
            addLog(`SCAN: ${longCount} Long, ${shortCount} Short setups found`);
        }

        return NextResponse.json({
            status: 'success',
            tick_time: new Date().toLocaleTimeString(),
            planned_count: plannedTrades.length
        });

    } catch (e) {
        console.error('Tick error:', e);
        addLog(`ERROR: ${e}`);
        return NextResponse.json({ status: 'error', message: String(e) }, { status: 500 });
    }
}

// Also allow GET for easy testing
export async function GET() {
    return POST();
}

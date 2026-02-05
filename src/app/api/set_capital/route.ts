import { NextResponse } from 'next/server';
import { getState, updateState, updateBrokerBalance } from '@/lib/state';
import { loadTradingState, saveTradingState } from '@/lib/storage';

export async function POST(req: Request) {
    // Hydrate
    const persistedState = await loadTradingState();
    if (persistedState) {
        updateState(persistedState);
    }

    try {
        const { amount } = await req.json();
        const state = getState();

        // Update both initial capital and current balance for the active broker
        const activeBroker = state.all_brokers?.[state.broker_mode] || (state as any); // fallback

        // We update via updateState API or specific helpers
        // For capital setting, we usually mean to reset or top-up
        updateState({ initial_capital: amount, broker_balance: amount });

        await saveTradingState(getState());

        return NextResponse.json({ success: true, capital: amount });
    } catch (e) {
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

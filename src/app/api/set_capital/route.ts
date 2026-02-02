import { NextRequest, NextResponse } from 'next/server';
import { getState, updateState, addLog, resetState } from '@/lib/state';

export async function POST(request: NextRequest) {
    const body = await request.json();
    const amount = body.amount ?? 100000;

    // Reset state and set new capital
    updateState({
        initial_capital: amount,
        pnl: 0,
        risk_consumed: 0,
        equity_history: [{ time: new Date().toLocaleTimeString(), equity: amount }]
    });
    addLog(`Capital reset to ₹${amount.toLocaleString()}`);

    return NextResponse.json({ status: "success", capital: amount });
}

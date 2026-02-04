import { NextResponse } from 'next/server';
import { resetRiskState, getRiskSummary } from '@/lib/riskEngine';
import { addLog } from '@/lib/state';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const equity = body.equity || 100000;

        resetRiskState(equity);
        addLog(`[RISK] Risk engine manually reset with equity: ₹${equity.toLocaleString()}`);

        return NextResponse.json({
            status: 'success',
            message: 'Risk engine reset successfully',
            risk_summary: getRiskSummary()
        });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            message: String(error)
        }, { status: 500 });
    }
}

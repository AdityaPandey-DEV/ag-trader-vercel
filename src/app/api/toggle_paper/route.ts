import { NextRequest, NextResponse } from 'next/server';
import { getState, updateState, addLog } from '@/lib/state';

export async function POST(request: NextRequest) {
    const body = await request.json();
    const enabled = body.enabled ?? true;
    updateState({ paper_mode: enabled });
    addLog(`Switched to ${enabled ? 'PAPER' : 'LIVE'} mode`);
    return NextResponse.json({ status: "success", paper_mode: enabled });
}

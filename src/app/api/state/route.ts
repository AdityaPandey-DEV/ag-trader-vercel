import { NextResponse } from 'next/server';
import { getState, updateState, updateEquity, addLog } from '@/lib/state';

export async function GET() {
    // Update equity on each poll (simulates time-based update)
    updateEquity();
    return NextResponse.json(getState());
}

import { NextRequest, NextResponse } from 'next/server';
import { getState, updateState, addLog } from '@/lib/state';

export async function POST(request: NextRequest) {
    try {
        const contentType = request.headers.get('content-type');
        let enabled = true;

        // Handle both JSON and empty body
        if (contentType?.includes('application/json')) {
            const text = await request.text();
            if (text) {
                const body = JSON.parse(text);
                enabled = body.enabled ?? !getState().paper_mode;
            } else {
                // Empty body - just toggle
                enabled = !getState().paper_mode;
            }
        } else {
            // No content-type - just toggle
            enabled = !getState().paper_mode;
        }

        updateState({ paper_mode: enabled });
        addLog(`Switched to ${enabled ? 'PAPER' : '🔥 LIVE'} mode`);

        return NextResponse.json({
            status: "success",
            paper_mode: enabled
        });
    } catch (e) {
        console.error('Toggle error:', e);
        // On error, just toggle
        const newMode = !getState().paper_mode;
        updateState({ paper_mode: newMode });
        addLog(`Switched to ${newMode ? 'PAPER' : '🔥 LIVE'} mode`);
        return NextResponse.json({
            status: "success",
            paper_mode: newMode
        });
    }
}

import { NextResponse } from 'next/server';
import { isUpstoxAuthenticatedAsync as checkAuth } from '@/lib/upstoxApi';
import { clearToken, loadToken } from '@/lib/redis';

export async function GET() {
    try {
        const isAuthenticated = await checkAuth();

        if (!isAuthenticated) {
            return NextResponse.json({ valid: false, reason: 'No active session' });
        }

        // Additional check: Inspect Redis expiry directly if needed
        const token = await loadToken();
        if (!token) {
            return NextResponse.json({ valid: false, reason: 'Token missing in Redis' });
        }

        return NextResponse.json({
            valid: true,
            message: 'Session active until Midnight IST'
        });

    } catch (error) {
        return NextResponse.json({ valid: false, error: String(error) }, { status: 500 });
    }
}

export async function DELETE() {
    await clearToken();
    return NextResponse.json({ success: true, message: 'Token cleared' });
}

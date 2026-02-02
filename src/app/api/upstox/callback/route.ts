
import { NextResponse } from 'next/server';
import { handleUpstoxCallback } from '@/lib/upstoxApi';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    try {
        await handleUpstoxCallback(code);

        // Redirect back to dashboard with success param
        return NextResponse.redirect(new URL('/?upstox=connected', request.url));
    } catch (error) {
        console.error('Upstox Callback Error:', error);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}

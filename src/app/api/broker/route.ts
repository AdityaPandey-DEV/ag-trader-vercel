import { NextResponse } from 'next/server';
import { getState, setBrokerMode, updateBrokerBalance, BrokerMode } from '@/lib/state';
import { isDhanConfigured, getBalance as getDhanBalance } from '@/lib/dhanApi';
import { isUpstoxAuthenticatedAsync, getUpstoxBalance } from '@/lib/upstoxApi';

/**
 * GET /api/broker
 * Returns available brokers and their connection status
 */
export async function GET() {
    const state = getState();
    const dhanConfigured = isDhanConfigured();
    const upstoxConnected = await isUpstoxAuthenticatedAsync();

    // Fetch balances for connected brokers
    let dhanBalance: number | null = null;
    let upstoxBalance: number | null = null;

    if (dhanConfigured && state.broker_mode === 'DHAN') {
        try {
            const result = await getDhanBalance();
            dhanBalance = result?.available ?? null;
        } catch (e) {
            console.error('Dhan balance error:', e);
        }
    }

    if (upstoxConnected && state.broker_mode === 'UPSTOX') {
        upstoxBalance = await getUpstoxBalance();
    }

    // Determine current balance based on broker mode
    let currentBalance = state.broker_balance;
    if (state.broker_mode === 'DHAN' && dhanBalance !== null) {
        currentBalance = dhanBalance;
    } else if (state.broker_mode === 'UPSTOX' && upstoxBalance !== null) {
        currentBalance = upstoxBalance;
    }

    return NextResponse.json({
        current_broker: state.broker_mode,
        current_balance: currentBalance,
        brokers: [
            {
                id: 'PAPER',
                name: 'Paper Trade',
                connected: true, // Always available
                balance: state.broker_mode === 'PAPER' ? state.broker_balance : null
            },
            {
                id: 'DHAN',
                name: 'Dhan',
                connected: dhanConfigured,
                balance: dhanBalance,
                login_url: null // Dhan uses API key, no OAuth
            },
            {
                id: 'UPSTOX',
                name: 'Upstox',
                connected: upstoxConnected,
                balance: upstoxBalance,
                login_url: upstoxConnected ? null : '/api/upstox/login'
            }
        ]
    });
}

/**
 * POST /api/broker
 * Switch broker mode or update paper balance
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { broker, paper_balance } = body;

        // Update broker mode if provided
        if (broker && ['PAPER', 'DHAN', 'UPSTOX'].includes(broker)) {
            setBrokerMode(broker as BrokerMode);

            // Update balance based on new broker
            if (broker === 'PAPER' && paper_balance !== undefined) {
                updateBrokerBalance(paper_balance);
            }
        }

        // Update paper balance if provided (only for PAPER mode)
        if (paper_balance !== undefined) {
            const state = getState();
            if (state.broker_mode === 'PAPER') {
                updateBrokerBalance(paper_balance);
            }
        }

        const state = getState();
        return NextResponse.json({
            success: true,
            broker_mode: state.broker_mode,
            broker_balance: state.broker_balance
        });
    } catch (error) {
        console.error('Broker API error:', error);
        return NextResponse.json({
            success: false,
            error: String(error)
        }, { status: 500 });
    }
}

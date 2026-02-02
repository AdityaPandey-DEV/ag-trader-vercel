// Dhan API Integration
// Handles live market data, order execution, and account management

import { addLog } from './state';
import { getMarketInfo } from './marketHours';

// Dhan API Configuration
const DHAN_BASE_URL = 'https://api.dhan.co';
const DHAN_CLIENT_ID = process.env.DHAN_CLIENT_ID || '';
const DHAN_ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN || '';

/**
 * Check if Dhan is configured
 */
export function isDhanConfigured(): boolean {
    return !!(DHAN_CLIENT_ID && DHAN_ACCESS_TOKEN);
}

/**
 * Get Dhan API headers
 */
function getHeaders(): Record<string, string> {
    return {
        'access-token': DHAN_ACCESS_TOKEN,
        'client-id': DHAN_CLIENT_ID,
        'Content-Type': 'application/json'
    };
}

/**
 * NSE symbol to security ID mapping
 * In production, this should be fetched from Dhan's instrument master
 */
const SYMBOL_MAP: Record<string, string> = {
    'RELIANCE': '2885',
    'TCS': '11536',
    'INFY': '1594',
    'HDFCBANK': '1333',
    'ICICIBANK': '4963',
    'SBIN': '3045',
    'AXISBANK': '5900',
    'BHARTIARTL': '10604',
    'ITC': '1660',
    'LT': '11483',
    'KOTAKBANK': '1922',
    'WIPRO': '3787',
    'MARUTI': '10999',
    'TITAN': '3506',
    'SUNPHARMA': '3351',
    'BAJFINANCE': '317',
    'NESTLEIND': '17963',
    'ADANIENT': '25',
    'TATASTEEL': '3499',
    'POWERGRID': '14977'
};

/**
 * Get security ID for a symbol
 */
function getSecurityId(symbol: string): string | null {
    return SYMBOL_MAP[symbol] || null;
}

/**
 * Order types
 */
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
export type OrderSide = 'BUY' | 'SELL';
export type ProductType = 'INTRADAY' | 'CNC' | 'MARGIN';

/**
 * Order result
 */
export interface OrderResult {
    success: boolean;
    orderId?: string;
    message?: string;
    status?: string;
}

/**
 * OCO Order result (both entry and SL orders)
 */
export interface OCOOrderResult {
    entryOrder: OrderResult;
    stopLossOrder?: OrderResult;
    targetOrder?: OrderResult;
}

/**
 * Order tracking
 */
interface TrackedOrder {
    orderId: string;
    symbol: string;
    side: OrderSide;
    qty: number;
    orderType: OrderType;
    price?: number;
    status: 'PENDING' | 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
    linkedOrders?: string[];  // For OCO
    createdAt: Date;
    updatedAt: Date;
}

// In-memory order tracking
const orderTracker: Map<string, TrackedOrder> = new Map();

/**
 * Fetch live quotes from Dhan
 */
export async function fetchQuotes(symbols: string[]): Promise<Record<string, any>> {
    if (!isDhanConfigured()) {
        return {};
    }

    try {
        const securityIds = symbols
            .map(s => getSecurityId(s))
            .filter(id => id !== null);

        if (securityIds.length === 0) {
            return {};
        }

        const response = await fetch(`${DHAN_BASE_URL}/v2/marketfeed/ltp`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                NSE_EQ: securityIds
            })
        });

        if (!response.ok) {
            console.error('Dhan quotes error:', response.status);
            return {};
        }

        const data = await response.json();

        // Transform response to our format
        const quotes: Record<string, any> = {};

        for (const symbol of symbols) {
            const secId = getSecurityId(symbol);
            if (secId && data.data?.[secId]) {
                const quote = data.data[secId];
                quotes[symbol] = {
                    symbol,
                    open: quote.open || quote.ltp,
                    high: quote.high || quote.ltp,
                    low: quote.low || quote.ltp,
                    close: quote.ltp,
                    lastPrice: quote.ltp,
                    volume: quote.volume || 0,
                    change: quote.change || 0,
                    changePercent: quote.changePercent || 0
                };
            }
        }

        return quotes;
    } catch (error) {
        console.error('Dhan fetchQuotes error:', error);
        return {};
    }
}

/**
 * Place a single order
 */
export async function placeOrder(
    symbol: string,
    side: OrderSide,
    qty: number,
    orderType: OrderType = 'MARKET',
    price?: number,
    simulate: boolean = true
): Promise<OrderResult> {
    const securityId = getSecurityId(symbol);

    if (!securityId) {
        return { success: false, message: `Unknown symbol: ${symbol}` };
    }

    // Simulation mode
    if (simulate || !isDhanConfigured()) {
        const mockOrderId = `SIM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Track the simulated order
        orderTracker.set(mockOrderId, {
            orderId: mockOrderId,
            symbol,
            side,
            qty,
            orderType,
            price,
            status: 'FILLED',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        return {
            success: true,
            orderId: mockOrderId,
            status: 'FILLED',
            message: 'Simulated order'
        };
    }

    // Live order
    try {
        const orderPayload = {
            dhanClientId: DHAN_CLIENT_ID,
            transactionType: side,
            exchangeSegment: 'NSE_EQ',
            productType: 'INTRADAY',
            orderType: orderType,
            validity: 'DAY',
            securityId: securityId,
            quantity: qty,
            price: orderType === 'LIMIT' ? price : 0,
            triggerPrice: orderType === 'SL' || orderType === 'SL-M' ? price : 0,
            disclosedQuantity: 0,
            afterMarketOrder: false
        };

        const response = await fetch(`${DHAN_BASE_URL}/v2/orders`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(orderPayload)
        });

        const data = await response.json();

        if (response.ok && data.orderId) {
            // Track the order
            orderTracker.set(data.orderId, {
                orderId: data.orderId,
                symbol,
                side,
                qty,
                orderType,
                price,
                status: 'PLACED',
                createdAt: new Date(),
                updatedAt: new Date()
            });

            addLog(`📤 Order placed: ${side} ${qty} ${symbol} - ${data.orderId}`);

            return {
                success: true,
                orderId: data.orderId,
                status: data.orderStatus || 'PLACED'
            };
        } else {
            return {
                success: false,
                message: data.message || 'Order failed'
            };
        }
    } catch (error) {
        console.error('Dhan placeOrder error:', error);
        return { success: false, message: String(error) };
    }
}

/**
 * Place OCO Order (One-Cancels-Other)
 * Entry order with automatic SL and Target orders
 */
export async function placeOCOOrder(
    symbol: string,
    side: OrderSide,
    qty: number,
    entryPrice: number,
    stopLoss: number,
    target: number,
    simulate: boolean = true
): Promise<OCOOrderResult> {
    // Place entry order first
    const entryOrder = await placeOrder(symbol, side, qty, 'LIMIT', entryPrice, simulate);

    if (!entryOrder.success) {
        return { entryOrder };
    }

    // Determine exit side (opposite of entry)
    const exitSide: OrderSide = side === 'BUY' ? 'SELL' : 'BUY';

    // Place stop-loss order
    const stopLossOrder = await placeOrder(
        symbol,
        exitSide,
        qty,
        'SL-M',
        stopLoss,
        simulate
    );

    // Place target order
    const targetOrder = await placeOrder(
        symbol,
        exitSide,
        qty,
        'LIMIT',
        target,
        simulate
    );

    // Link orders for tracking
    if (entryOrder.orderId) {
        const linkedOrders = [
            stopLossOrder.orderId,
            targetOrder.orderId
        ].filter(id => id) as string[];

        const trackedEntry = orderTracker.get(entryOrder.orderId);
        if (trackedEntry) {
            trackedEntry.linkedOrders = linkedOrders;
            orderTracker.set(entryOrder.orderId, trackedEntry);
        }
    }

    addLog(`🎯 OCO: ${side} ${symbol} @ ${entryPrice} | SL: ${stopLoss} | TGT: ${target}`);

    return {
        entryOrder,
        stopLossOrder,
        targetOrder
    };
}

/**
 * Cancel an order
 */
export async function cancelOrder(orderId: string, simulate: boolean = true): Promise<boolean> {
    const tracked = orderTracker.get(orderId);

    if (!tracked) {
        return false;
    }

    if (simulate || orderId.startsWith('SIM_')) {
        tracked.status = 'CANCELLED';
        tracked.updatedAt = new Date();
        orderTracker.set(orderId, tracked);
        return true;
    }

    try {
        const response = await fetch(`${DHAN_BASE_URL}/v2/orders/${orderId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (response.ok) {
            tracked.status = 'CANCELLED';
            tracked.updatedAt = new Date();
            orderTracker.set(orderId, tracked);
            addLog(`🚫 Order cancelled: ${orderId}`);
            return true;
        }

        return false;
    } catch (error) {
        console.error('Dhan cancelOrder error:', error);
        return false;
    }
}

/**
 * Get order status
 */
export async function getOrderStatus(orderId: string): Promise<TrackedOrder | null> {
    const tracked = orderTracker.get(orderId);

    if (!tracked) {
        return null;
    }

    // For simulated orders, just return tracked status
    if (orderId.startsWith('SIM_')) {
        return tracked;
    }

    // For live orders, fetch from Dhan
    if (isDhanConfigured()) {
        try {
            const response = await fetch(`${DHAN_BASE_URL}/v2/orders/${orderId}`, {
                method: 'GET',
                headers: getHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                tracked.status = data.orderStatus || tracked.status;
                tracked.updatedAt = new Date();
                orderTracker.set(orderId, tracked);
            }
        } catch (error) {
            console.error('Dhan getOrderStatus error:', error);
        }
    }

    return tracked;
}

/**
 * Get all open orders
 */
export function getOpenOrders(): TrackedOrder[] {
    return Array.from(orderTracker.values()).filter(
        o => o.status === 'PENDING' || o.status === 'PLACED'
    );
}

/**
 * Get account balance
 */
export async function getBalance(): Promise<{ available: number; utilized: number } | null> {
    if (!isDhanConfigured()) {
        return { available: 100000, utilized: 0 }; // Mock balance
    }

    try {
        const response = await fetch(`${DHAN_BASE_URL}/v2/fundlimit`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            return {
                available: data.availableFund || 0,
                utilized: data.utilizedFund || 0
            };
        }

        return null;
    } catch (error) {
        console.error('Dhan getBalance error:', error);
        return null;
    }
}

/**
 * Get current positions
 */
export async function getPositions(): Promise<any[]> {
    if (!isDhanConfigured()) {
        return [];
    }

    try {
        const response = await fetch(`${DHAN_BASE_URL}/v2/positions`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            return data.data || [];
        }

        return [];
    } catch (error) {
        console.error('Dhan getPositions error:', error);
        return [];
    }
}

/**
 * Square off all positions
 * Used for auto square-off at market close or emergency exit
 */
export async function squareOffAll(reason: string, simulate: boolean = true): Promise<{
    success: boolean;
    closedCount: number;
    errors: string[];
}> {
    const errors: string[] = [];
    let closedCount = 0;

    addLog(`🔴 SQUARE OFF ALL: ${reason}`);

    if (simulate) {
        // In simulation, just clear tracked orders
        const openOrders = getOpenOrders();
        for (const order of openOrders) {
            order.status = 'CANCELLED';
            order.updatedAt = new Date();
            orderTracker.set(order.orderId, order);
            closedCount++;
        }
        return { success: true, closedCount, errors };
    }

    // Live square-off
    try {
        // Get all positions
        const positions = await getPositions();

        for (const position of positions) {
            if (position.netQty !== 0) {
                const side: OrderSide = position.netQty > 0 ? 'SELL' : 'BUY';
                const qty = Math.abs(position.netQty);
                const symbol = position.tradingSymbol;

                const result = await placeOrder(symbol, side, qty, 'MARKET', undefined, false);

                if (result.success) {
                    closedCount++;
                    addLog(`✅ Squared off: ${symbol} x ${qty}`);
                } else {
                    errors.push(`Failed to square off ${symbol}: ${result.message}`);
                }
            }
        }

        // Cancel all pending orders
        const openOrders = getOpenOrders();
        for (const order of openOrders) {
            await cancelOrder(order.orderId, false);
        }

        return { success: errors.length === 0, closedCount, errors };
    } catch (error) {
        errors.push(String(error));
        return { success: false, closedCount, errors };
    }
}

/**
 * Check if auto square-off time has been reached
 * Default: 3:15 PM IST (15 minutes before market close)
 */
export function shouldAutoSquareOff(): boolean {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    // 3:15 PM = 15:15
    return hours > 15 || (hours === 15 && minutes >= 15);
}

/**
 * Get time remaining until auto square-off
 */
export function getTimeUntilSquareOff(): { hours: number; minutes: number; seconds: number } | null {
    const marketInfo = getMarketInfo();

    if (marketInfo.status === 'CLOSED') {
        return null;
    }

    const now = new Date();
    const squareOffTime = new Date(now);
    squareOffTime.setHours(15, 15, 0, 0); // 3:15 PM

    if (now >= squareOffTime) {
        return { hours: 0, minutes: 0, seconds: 0 };
    }

    const diffMs = squareOffTime.getTime() - now.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    return { hours, minutes, seconds };
}

/**
 * Clear order tracker (for new day)
 */
export function clearOrderTracker(): void {
    orderTracker.clear();
}

/**
 * Get order summary
 */
export function getOrderSummary(): {
    total: number;
    pending: number;
    filled: number;
    cancelled: number;
    rejected: number;
} {
    const orders = Array.from(orderTracker.values());

    return {
        total: orders.length,
        pending: orders.filter(o => o.status === 'PENDING' || o.status === 'PLACED').length,
        filled: orders.filter(o => o.status === 'FILLED').length,
        cancelled: orders.filter(o => o.status === 'CANCELLED').length,
        rejected: orders.filter(o => o.status === 'REJECTED').length
    };
}

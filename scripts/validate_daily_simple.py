#!/usr/bin/env python3
"""
Daily Data Optimized Strategy
Simplified entry logic for daily timeframe
"""

import json
import os
from typing import List, Dict

INITIAL_CAPITAL = 500000
RISK_PER_TRADE = 0.01  # 1% risk for daily (less frequent trades)
SLIPPAGE_PCT = 0.001
BROKERAGE = 20
STT = 0.001

EMA_FAST = 9
EMA_SLOW = 21
TRAILING_ATR_MULT = 2.0

DATA_DIR = "data/tv_data_daily"

def calculate_ema(prices: List[float], period: int) -> float:
    if len(prices) < period:
        return 0
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    return ema

def calculate_atr(candles: List[Dict], period: int = 14) -> float:
    if len(candles) < 2:
        return 0
    true_ranges = []
    for i in range(1, len(candles)):
        high = candles[i]['high']
        low = candles[i]['low']
        prev_close = candles[i-1]['close']
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        true_ranges.append(tr)
    if len(true_ranges) < period:
        return sum(true_ranges) / len(true_ranges) if true_ranges else 0
    return sum(true_ranges[-period:]) / period

def calculate_adx(candles: List[Dict], period: int = 14) -> float:
    """Simplified ADX calculation"""
    if len(candles) < period + 1:
        return 0
    
    plus_dm_sum = 0
    minus_dm_sum = 0
    tr_sum = 0
    
    for i in range(1, min(period + 1, len(candles))):
        high = candles[i]['high']
        low = candles[i]['low']
        prev_high = candles[i-1]['high']
        prev_low = candles[i-1]['low']
        prev_close = candles[i-1]['close']
        
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr_sum += tr
        
        up_move = high - prev_high
        down_move = prev_low - low
        
        if up_move > down_move and up_move > 0:
            plus_dm_sum += up_move
        if down_move > up_move and down_move > 0:
            minus_dm_sum += down_move
    
    if tr_sum == 0:
        return 0
    
    plus_di = (plus_dm_sum / tr_sum) * 100
    minus_di = (minus_dm_sum / tr_sum) * 100
    
    di_sum = plus_di + minus_di
    if di_sum == 0:
        return 0
    
    dx = (abs(plus_di - minus_di) / di_sum) * 100
    return dx

def validate_daily(symbol: str, start_date: str, end_date: str):
    """Validate on daily data with simplified logic"""
    print(f"\n{'='*70}")
    print(f"DAILY OPTIMIZED STRATEGY: {symbol}")
    print(f"Period: {start_date} to {end_date}")
    print(f"{'='*70}")
    
    file_path = os.path.join(DATA_DIR, f"{symbol}.json")
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    candles = [c for c in data['candles'] 
               if start_date <= c['timestamp'][:10] <= end_date]
    
    if len(candles) < 50:
        print(f"❌ Not enough data")
        return None
    
    print(f"📅 Trading days: {len(candles)}")
    print(f"💰 Price: ₹{candles[0]['close']:.2f} → ₹{candles[-1]['close']:.2f}")
    buy_hold = ((candles[-1]['close'] - candles[0]['close']) / candles[0]['close'] * 100)
    print(f"📈 Buy & Hold: {buy_hold:.1f}%")
    
    # Backtest with SIMPLE daily logic
    trades = 0
    wins = 0
    pnl = 0
    equity = INITIAL_CAPITAL
    peak = INITIAL_CAPITAL
    max_dd = 0
    total_r = 0
    
    in_position = False
    entry_price = 0
    entry_trend = ''
    stop_loss = 0
    qty = 0
    
    for i in range(EMA_SLOW + 5, len(candles)):
        lookback = candles[max(0, i - 30):i]
        
        closes = [c['close'] for c in lookback]
        fast_ema = calculate_ema(closes, EMA_FAST)
        slow_ema = calculate_ema(closes, EMA_SLOW)
        current_close = candles[i]['close']
        atr = calculate_atr(lookback)
        adx = calculate_adx(lookback)
        
        # Skip if ADX < 20 (choppy)
        if adx < 20:
            continue
        
        # Entry logic - simple EMA crossover
        if not in_position:
            # Long entry
            if fast_ema > slow_ema and current_close > fast_ema:
                entry_trend = 'UP'
                entry_price = current_close * (1 + SLIPPAGE_PCT)
                stop_loss = current_close - atr * 2
                risk = entry_price - stop_loss
                
                if risk > 0:
                    risk_amount = equity * RISK_PER_TRADE
                    qty = int(risk_amount / risk)
                    
                    if qty > 0:
                        in_position = True
                        trades += 1
            
            # Short entry
            elif fast_ema < slow_ema and current_close < fast_ema:
                entry_trend = 'DOWN'
                entry_price = current_close * (1 - SLIPPAGE_PCT)
                stop_loss = current_close + atr * 2
                risk = stop_loss - entry_price
                
                if risk > 0:
                    risk_amount = equity * RISK_PER_TRADE
                    qty = int(risk_amount / risk)
                    
                    if qty > 0:
                        in_position = True
                        trades += 1
        
        # Exit logic - trailing stop
        else:
            current_high = candles[i]['high']
            current_low = candles[i]['low']
            
            if entry_trend == 'UP':
                # Update trailing stop
                new_stop = current_high - atr * TRAILING_ATR_MULT
                if new_stop > stop_loss:
                    stop_loss = new_stop
                
                # Check if stopped out
                if current_low <= stop_loss:
                    exit_price = max(stop_loss, candles[i]['open']) * (1 - SLIPPAGE_PCT)
                    trade_pnl = (exit_price - entry_price) * qty
                    costs = BROKERAGE * 2 + abs(trade_pnl) * STT
                    net = trade_pnl - costs
                    
                    r_multiple = net / (equity * RISK_PER_TRADE)
                    total_r += r_multiple
                    
                    pnl += net
                    equity += net
                    
                    if equity > peak:
                        peak = equity
                    dd = (peak - equity) / peak
                    if dd > max_dd:
                        max_dd = dd
                    
                    if net > 0:
                        wins += 1
                    
                    in_position = False
            
            else:  # DOWN
                # Update trailing stop
                new_stop = current_low + atr * TRAILING_ATR_MULT
                if new_stop < stop_loss:
                    stop_loss = new_stop
                
                # Check if stopped out
                if current_high >= stop_loss:
                    exit_price = min(stop_loss, candles[i]['open']) * (1 + SLIPPAGE_PCT)
                    trade_pnl = (entry_price - exit_price) * qty
                    costs = BROKERAGE * 2 + abs(trade_pnl) * STT
                    net = trade_pnl - costs
                    
                    r_multiple = net / (equity * RISK_PER_TRADE)
                    total_r += r_multiple
                    
                    pnl += net
                    equity += net
                    
                    if equity > peak:
                        peak = equity
                    dd = (peak - equity) / peak
                    if dd > max_dd:
                        max_dd = dd
                    
                    if net > 0:
                        wins += 1
                    
                    in_position = False
    
    # Close any open position
    if in_position:
        exit_price = candles[-1]['close']
        if entry_trend == 'UP':
            trade_pnl = (exit_price - entry_price) * qty
        else:
            trade_pnl = (entry_price - exit_price) * qty
        
        costs = BROKERAGE * 2 + abs(trade_pnl) * STT
        net = trade_pnl - costs
        pnl += net
        equity += net
        
        if net > 0:
            wins += 1
    
    # Results
    win_rate = (wins / trades * 100) if trades > 0 else 0
    total_return = (pnl / INITIAL_CAPITAL * 100)
    avg_r = total_r / trades if trades > 0 else 0
    months = len(candles) / 20
    monthly_return = total_return / months if months > 0 else 0
    
    print(f"\n📊 RESULTS:")
    print(f"   Trades: {trades}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: ₹{pnl:,.0f}")
    print(f"   Total Return: {total_return:.1f}%")
    print(f"   Monthly Return: {monthly_return:.1f}%")
    print(f"   Max DD: {max_dd * 100:.1f}%")
    print(f"   Avg R: {avg_r:.2f}R")
    
    return {
        'trades': trades,
        'win_rate': win_rate,
        'pnl': pnl,
        'total_return': total_return,
        'monthly_return': monthly_return
    }

def main():
    print("=" * 70)
    print("DAILY-OPTIMIZED STRATEGY (SIMPLE EMA CROSSOVER + ADX FILTER)")
    print("=" * 70)
    print("\nStrategy:")
    print("  Entry: EMA 9/21 crossover + ADX > 20")
    print("  Exit: 2x ATR trailing stop")
    print("  Risk: 1% per trade")
    
    # Test periods
    print("\n🚀 TEST 1: COVID RALLY (Mar-Sep 2020)")
    covid = validate_daily('RELIANCE', '2020-03-23', '2020-09-14')
    
    print("\n\n🚀 TEST 2: 2005-2006 RALLY")
    rally = validate_daily('RELIANCE', '2005-11-11', '2006-05-10')
    
    print("\n\n🚀 TEST 3: FULL 20-YEAR PERIOD")
    full = validate_daily('RELIANCE', '2005-11-11', '2026-02-02')
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    results = [r for r in [covid, rally, full] if r]
    if results:
        for i, r in enumerate(results, 1):
            print(f"\nTest {i}: {r['trades']} trades, {r['monthly_return']:.1f}% monthly")
        
        avg_monthly = sum(r['monthly_return'] for r in results) / len(results)
        print(f"\n✅ Average Monthly Return: {avg_monthly:.1f}%")
        print(f"✅ Target: 3-8% monthly")
        
        if avg_monthly >= 3:
            print(f"\n🎯 TARGET ACHIEVED!")
        else:
            print(f"\n⚠️ Below target. Daily data may not be ideal for this strategy.")

if __name__ == "__main__":
    main()

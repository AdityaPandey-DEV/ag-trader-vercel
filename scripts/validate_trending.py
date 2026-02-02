#!/usr/bin/env python3
"""
Validate Upgraded Strategy on Specific Period
Tests strategy on a chosen date range
"""

import json
import os
from datetime import datetime
from typing import List, Dict

# Same configuration as validate_upgraded.py
INITIAL_CAPITAL = 500000
RISK_PER_TRADE = 0.003
MAX_TRADES_PER_DAY = 2
MAX_DAILY_LOSS = 0.01
KILL_SWITCH_DD = 0.05
KILL_SWITCH_DAYS = 5

# Relaxed filters for trending markets
MIN_FIRST_HOUR_RANGE_ATR = 0.4
MIN_EMA_SLOPE = 0.003  # 0.3% slope (relaxed)
MIN_TRADE_SCORE = 0.5  # 50% quality

SLIPPAGE_PCT = 0.0005
BROKERAGE = 20
STT = 0.001

EMA_FAST = 13
EMA_SLOW = 34
PULLBACK_ATR = 2.0
TRAILING_ATR_MULT = 1.5

DATA_DIR = "data/tv_data_daily"

# Import functions from validate_upgraded.py
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

def is_trend_strong(candles: List[Dict], ema_period: int = 25) -> bool:
    if len(candles) < ema_period + 10:
        return False
    closes = [c['close'] for c in candles]
    current_ema = calculate_ema(closes, ema_period)
    past_ema = calculate_ema(closes[:-10], ema_period)
    if past_ema == 0:
        return False
    slope = (current_ema - past_ema) / past_ema
    return abs(slope) >= MIN_EMA_SLOPE

def calculate_trade_quality(candles: List[Dict]) -> float:
    if len(candles) < EMA_SLOW + 5:
        return 0
    closes = [c['close'] for c in candles]
    fast_ema = calculate_ema(closes, EMA_FAST)
    slow_ema = calculate_ema(closes, EMA_SLOW)
    separation = abs(fast_ema - slow_ema) / slow_ema if slow_ema > 0 else 0
    trend_strength = min(separation * 100, 1.0)
    recent = candles[-10:]
    swing_high = max(c['high'] for c in recent)
    swing_low = min(c['low'] for c in recent)
    current = closes[-1]
    range_val = swing_high - swing_low
    if range_val > 0:
        pullback_from_high = (swing_high - current) / range_val
        pullback_from_low = (current - swing_low) / range_val
        depth = max(pullback_from_high, pullback_from_low)
        if depth <= 0.5:
            pullback_score = depth * 2
        else:
            pullback_score = max(0, 1 - (depth - 0.5) * 2)
    else:
        pullback_score = 0
    if len(candles) >= 20:
        avg_volume = sum(c['volume'] for c in candles[-20:-1]) / 19
        current_volume = candles[-1]['volume']
        volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1
        volume_score = min(volume_ratio / 2, 1.0)
    else:
        volume_score = 0.5
    score = trend_strength * 0.4 + pullback_score * 0.4 + volume_score * 0.2
    return score

def detect_trend_and_pullback(candles: List[Dict]):
    if len(candles) < EMA_SLOW + 5:
        return 'NEUTRAL', False
    closes = [c['close'] for c in candles]
    fast_ema = calculate_ema(closes, EMA_FAST)
    slow_ema = calculate_ema(closes, EMA_SLOW)
    current_close = closes[-1]
    atr = calculate_atr(candles)
    trend = 'NEUTRAL'
    if fast_ema > slow_ema and current_close > slow_ema:
        trend = 'UP'
    elif fast_ema < slow_ema and current_close < slow_ema:
        trend = 'DOWN'
    is_pullback = False
    if trend == 'UP':
        dip = fast_ema - current_close
        is_pullback = dip > atr * PULLBACK_ATR * 0.3 and dip < atr * PULLBACK_ATR
    elif trend == 'DOWN':
        rally = current_close - fast_ema
        is_pullback = rally > atr * PULLBACK_ATR * 0.3 and rally < atr * PULLBACK_ATR
    return trend, is_pullback

def validate_period(symbol: str, start_date: str, end_date: str):
    """Validate strategy on specific period"""
    print(f"\n{'='*70}")
    print(f"VALIDATING {symbol}: {start_date} to {end_date}")
    print(f"{'='*70}")
    
    file_path = os.path.join(DATA_DIR, f"{symbol}.json")
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    # Filter candles by date
    candles = [c for c in data['candles'] 
               if start_date <= c['timestamp'][:10] <= end_date]
    
    if len(candles) < 100:
        print(f"❌ Not enough data: {len(candles)} candles")
        return None
    
    print(f"📅 Trading days: {len(candles)}")
    print(f"💰 Price: ₹{candles[0]['close']:.2f} → ₹{candles[-1]['close']:.2f}")
    print(f"📈 Buy & Hold: {((candles[-1]['close'] - candles[0]['close']) / candles[0]['close'] * 100):.1f}%")
    
    # Backtest
    trades = 0
    wins = 0
    pnl = 0
    equity = INITIAL_CAPITAL
    peak = INITIAL_CAPITAL
    max_dd = 0
    total_r = 0
    
    for i in range(EMA_SLOW + 30, len(candles) - 1):
        lookback = candles[max(0, i - 60):i + 1]
        
        if not is_trend_strong(lookback, 25):
            continue
        
        trend, is_pullback = detect_trend_and_pullback(lookback)
        if trend == 'NEUTRAL' or not is_pullback:
            continue
        
        quality = calculate_trade_quality(lookback)
        if quality < MIN_TRADE_SCORE:
            continue
        
        # Execute trade
        entry = candles[i]['close']
        slip = entry * SLIPPAGE_PCT
        entry_price = entry + slip if trend == 'UP' else entry - slip
        
        atr = calculate_atr(lookback)
        swing_high = max(c['high'] for c in lookback[-10:])
        swing_low = min(c['low'] for c in lookback[-10:])
        
        stop = swing_low - atr * 0.5 if trend == 'UP' else swing_high + atr * 0.5
        risk = abs(entry_price - stop)
        if risk <= 0:
            continue
        
        risk_amount = equity * RISK_PER_TRADE
        qty = int(risk_amount / risk)
        if qty <= 0:
            continue
        
        # Find exit
        exit_price = candles[-1]['close']
        trailing_stop = stop
        trail_dist = atr * TRAILING_ATR_MULT
        
        for j in range(i + 1, min(i + 20, len(candles))):
            c = candles[j]
            if trend == 'UP':
                if c['high'] > entry_price + trail_dist:
                    trailing_stop = max(trailing_stop, c['high'] - trail_dist)
                if c['low'] <= trailing_stop:
                    exit_price = max(trailing_stop, c['open']) - slip
                    break
            else:
                if c['low'] < entry_price - trail_dist:
                    trailing_stop = min(trailing_stop, c['low'] + trail_dist)
                if c['high'] >= trailing_stop:
                    exit_price = min(trailing_stop, c['open']) + slip
                    break
        
        trade_pnl = (exit_price - entry_price) * qty if trend == 'UP' else (entry_price - exit_price) * qty
        costs = BROKERAGE * 2 + abs(trade_pnl) * STT
        net = trade_pnl - costs
        
        r_multiple = net / risk_amount
        total_r += r_multiple
        
        trades += 1
        pnl += net
        equity += net
        
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak
        if dd > max_dd:
            max_dd = dd
        
        if net > 0:
            wins += 1
    
    # Results
    win_rate = (wins / trades * 100) if trades > 0 else 0
    total_return = (pnl / INITIAL_CAPITAL * 100)
    avg_r = total_r / trades if trades > 0 else 0
    
    # Calculate monthly return
    months = len(candles) / 20  # ~20 trading days per month
    monthly_return = total_return / months if months > 0 else 0
    
    print(f"\n📊 RESULTS:")
    print(f"   Trades: {trades}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: ₹{pnl:,.0f}")
    print(f"   Total Return: {total_return:.1f}%")
    print(f"   Monthly Return: {monthly_return:.1f}%")
    print(f"   Max DD: {max_dd * 100:.1f}%")
    print(f"   Avg R-Multiple: {avg_r:.2f}R")
    
    return {
        'trades': trades,
        'win_rate': win_rate,
        'pnl': pnl,
        'total_return': total_return,
        'monthly_return': monthly_return,
        'max_dd': max_dd * 100,
        'avg_r': avg_r
    }

def main():
    print("=" * 70)
    print("UPGRADED STRATEGY - TRENDING PERIOD VALIDATION")
    print("=" * 70)
    
    # Test on COVID rally
    print("\n🚀 TEST 1: COVID RALLY (Mar-Sep 2020)")
    covid_result = validate_period('RELIANCE', '2020-03-23', '2020-09-14')
    
    # Test on 2005-2006 rally
    print("\n\n🚀 TEST 2: 2005-2006 RALLY")
    rally_2006 = validate_period('RELIANCE', '2005-11-11', '2006-05-10')
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    if covid_result and rally_2006:
        avg_monthly = (covid_result['monthly_return'] + rally_2006['monthly_return']) / 2
        print(f"\n✅ Average Monthly Return: {avg_monthly:.1f}%")
        print(f"✅ Target: 3-8% monthly")
        
        if avg_monthly >= 3:
            print(f"\n🎯 TARGET ACHIEVED! Strategy delivers {avg_monthly:.1f}% monthly in trending markets")
        else:
            print(f"\n⚠️ Below target. Need optimization.")

if __name__ == "__main__":
    main()

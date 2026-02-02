#!/usr/bin/env python3
"""
Validate Strategy with ADX-Based Regime Detection
Adaptive filters based on market conditions
"""

import json
import os
from typing import List, Dict, Tuple

# Configuration
INITIAL_CAPITAL = 500000
RISK_PER_TRADE = 0.003
MAX_TRADES_PER_DAY = 2
MAX_DAILY_LOSS = 0.01
KILL_SWITCH_DD = 0.05
KILL_SWITCH_DAYS = 5

SLIPPAGE_PCT = 0.0005
BROKERAGE = 20
STT = 0.001

EMA_FAST = 13
EMA_SLOW = 34
PULLBACK_ATR = 2.0
TRAILING_ATR_MULT = 1.5

DATA_DIR = "data/tv_data_daily"

# ============================================
# ADX Calculation
# ============================================

def wilder_smooth(values: List[float], period: int) -> List[float]:
    """Wilder's smoothing method"""
    if len(values) < period:
        return []
    
    smoothed = []
    first_sum = sum(values[:period])
    smoothed.append(first_sum / period)
    
    for i in range(period, len(values)):
        prev = smoothed[-1]
        current = values[i]
        next_val = (prev * (period - 1) + current) / period
        smoothed.append(next_val)
    
    return smoothed

def calculate_adx(candles: List[Dict], period: int = 14) -> float:
    """Calculate ADX (Average Directional Index)"""
    if len(candles) < period + 1:
        return 0
    
    true_ranges = []
    plus_dm = []
    minus_dm = []
    
    for i in range(1, len(candles)):
        high = candles[i]['high']
        low = candles[i]['low']
        prev_high = candles[i-1]['high']
        prev_low = candles[i-1]['low']
        prev_close = candles[i-1]['close']
        
        # True Range
        tr = max(
            high - low,
            abs(high - prev_close),
            abs(low - prev_close)
        )
        true_ranges.append(tr)
        
        # Directional Movement
        up_move = high - prev_high
        down_move = prev_low - low
        
        plus_dm_val = up_move if up_move > down_move and up_move > 0 else 0
        minus_dm_val = down_move if down_move > up_move and down_move > 0 else 0
        
        plus_dm.append(plus_dm_val)
        minus_dm.append(minus_dm_val)
    
    if len(true_ranges) < period:
        return 0
    
    # Smooth using Wilder's method
    smooth_tr = wilder_smooth(true_ranges, period)
    smooth_plus_dm = wilder_smooth(plus_dm, period)
    smooth_minus_dm = wilder_smooth(minus_dm, period)
    
    # Calculate +DI and -DI
    plus_di = []
    minus_di = []
    
    for i in range(len(smooth_tr)):
        if smooth_tr[i] == 0:
            plus_di.append(0)
            minus_di.append(0)
        else:
            plus_di.append((smooth_plus_dm[i] / smooth_tr[i]) * 100)
            minus_di.append((smooth_minus_dm[i] / smooth_tr[i]) * 100)
    
    # Calculate DX
    dx = []
    for i in range(len(plus_di)):
        di_sum = plus_di[i] + minus_di[i]
        if di_sum == 0:
            dx.append(0)
        else:
            di_diff = abs(plus_di[i] - minus_di[i])
            dx.append((di_diff / di_sum) * 100)
    
    if len(dx) < period:
        return 0
    
    # Calculate ADX (smoothed DX)
    adx_values = wilder_smooth(dx, period)
    return adx_values[-1] if adx_values else 0

# ============================================
# Regime Detection
# ============================================

def detect_regime(candles: List[Dict]) -> Dict:
    """Detect market regime based on ADX"""
    adx = calculate_adx(candles, 14)
    
    if adx >= 25:
        # Strong trend - strict filters
        return {
            'regime': 'TRENDING',
            'adx': adx,
            'should_trade': True,
            'min_ema_slope': 0.01,      # 1%
            'min_trade_score': 0.7,     # 70%
            'min_first_hour_atr': 0.4   # 40%
        }
    elif adx >= 15:
        # Normal market - relaxed filters
        return {
            'regime': 'NORMAL',
            'adx': adx,
            'should_trade': True,
            'min_ema_slope': 0.003,     # 0.3%
            'min_trade_score': 0.5,     # 50%
            'min_first_hour_atr': 0.3   # 30%
        }
    else:
        # Choppy market - skip trading
        return {
            'regime': 'CHOPPY',
            'adx': adx,
            'should_trade': False,
            'min_ema_slope': 0.0,
            'min_trade_score': 0.8,     # 80% if trading
            'min_first_hour_atr': 0.5   # 50%
        }

# ============================================
# Indicator Functions
# ============================================

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

def is_trend_strong(candles: List[Dict], min_slope: float) -> bool:
    if len(candles) < 35:
        return False
    closes = [c['close'] for c in candles]
    current_ema = calculate_ema(closes, 25)
    past_ema = calculate_ema(closes[:-10], 25)
    if past_ema == 0:
        return False
    slope = (current_ema - past_ema) / past_ema
    return abs(slope) >= min_slope

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
        pullback_score = depth * 2 if depth <= 0.5 else max(0, 1 - (depth - 0.5) * 2)
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

# ============================================
# Validation with Regime Detection
# ============================================

def validate_with_regime(symbol: str, start_date: str, end_date: str):
    """Validate with adaptive regime-based filters"""
    print(f"\n{'='*70}")
    print(f"REGIME-ADAPTIVE VALIDATION: {symbol}")
    print(f"Period: {start_date} to {end_date}")
    print(f"{'='*70}")
    
    file_path = os.path.join(DATA_DIR, f"{symbol}.json")
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    candles = [c for c in data['candles'] 
               if start_date <= c['timestamp'][:10] <= end_date]
    
    if len(candles) < 100:
        print(f"❌ Not enough data")
        return None
    
    print(f"📅 Trading days: {len(candles)}")
    print(f"💰 Price: ₹{candles[0]['close']:.2f} → ₹{candles[-1]['close']:.2f}")
    buy_hold = ((candles[-1]['close'] - candles[0]['close']) / candles[0]['close'] * 100)
    print(f"📈 Buy & Hold: {buy_hold:.1f}%")
    
    # Track regime stats
    regime_days = {'TRENDING': 0, 'NORMAL': 0, 'CHOPPY': 0}
    regime_trades = {'TRENDING': 0, 'NORMAL': 0, 'CHOPPY': 0}
    
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
        
        # Detect regime
        regime_info = detect_regime(lookback)
        regime_days[regime_info['regime']] += 1
        
        # Skip if choppy
        if not regime_info['should_trade']:
            continue
        
        # Apply regime-specific filters
        if not is_trend_strong(lookback, regime_info['min_ema_slope']):
            continue
        
        trend, is_pullback = detect_trend_and_pullback(lookback)
        if trend == 'NEUTRAL' or not is_pullback:
            continue
        
        quality = calculate_trade_quality(lookback)
        if quality < regime_info['min_trade_score']:
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
        regime_trades[regime_info['regime']] += 1
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
    
    print(f"\n🎯 REGIME BREAKDOWN:")
    total_days = sum(regime_days.values())
    for regime in ['TRENDING', 'NORMAL', 'CHOPPY']:
        days = regime_days[regime]
        trades_count = regime_trades[regime]
        pct = (days / total_days * 100) if total_days > 0 else 0
        print(f"   {regime:10} | Days: {days:3} ({pct:5.1f}%) | Trades: {trades_count:3}")
    
    return {
        'trades': trades,
        'win_rate': win_rate,
        'pnl': pnl,
        'total_return': total_return,
        'monthly_return': monthly_return,
        'max_dd': max_dd * 100,
        'avg_r': avg_r,
        'regime_days': regime_days,
        'regime_trades': regime_trades
    }

def main():
    print("=" * 70)
    print("REGIME-ADAPTIVE STRATEGY VALIDATION")
    print("=" * 70)
    print("\nAdaptive Filters:")
    print("  TRENDING (ADX ≥ 25): Strict filters (1% slope, 70% quality)")
    print("  NORMAL (ADX 15-25):   Relaxed filters (0.3% slope, 50% quality)")
    print("  CHOPPY (ADX < 15):    Skip trading")
    
    # Test periods
    print("\n🚀 TEST 1: COVID RALLY (Mar-Sep 2020)")
    covid = validate_with_regime('RELIANCE', '2020-03-23', '2020-09-14')
    
    print("\n\n🚀 TEST 2: 2005-2006 RALLY")
    rally = validate_with_regime('RELIANCE', '2005-11-11', '2006-05-10')
    
    print("\n\n🚀 TEST 3: CHOPPY PERIOD (Oct 2025-Feb 2026)")
    choppy = validate_with_regime('RELIANCE', '2025-10-27', '2026-02-02')
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY - REGIME-ADAPTIVE STRATEGY")
    print("=" * 70)
    
    results = [r for r in [covid, rally, choppy] if r]
    if results:
        avg_monthly = sum(r['monthly_return'] for r in results) / len(results)
        avg_trades = sum(r['trades'] for r in results) / len(results)
        avg_win_rate = sum(r['win_rate'] for r in results) / len(results)
        
        print(f"\n✅ Average Monthly Return: {avg_monthly:.1f}%")
        print(f"✅ Average Trades/Period: {avg_trades:.0f}")
        print(f"✅ Average Win Rate: {avg_win_rate:.1f}%")
        print(f"✅ Target: 3-8% monthly")
        
        if avg_monthly >= 3:
            print(f"\n🎯 TARGET ACHIEVED! Regime-adaptive strategy delivers {avg_monthly:.1f}% monthly")
        else:
            print(f"\n⚠️ Below target ({avg_monthly:.1f}% vs 3-8%). May need more optimization.")

if __name__ == "__main__":
    main()

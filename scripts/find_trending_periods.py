#!/usr/bin/env python3
"""
Find Best Trending Periods in Historical Data
Identifies periods with strong trends for strategy validation
"""

import json
import os
from typing import List, Dict

DATA_DIR = "data/tv_data_daily"

def calculate_trend_strength(candles: List[Dict], window: int = 60) -> List[Dict]:
    """Calculate trend strength for each period"""
    results = []
    
    for i in range(window, len(candles) - window):
        period_candles = candles[i-window:i+window]
        
        # Calculate price change
        start_price = period_candles[0]['close']
        end_price = period_candles[-1]['close']
        price_change_pct = ((end_price - start_price) / start_price) * 100
        
        # Calculate volatility (std dev of returns)
        returns = []
        for j in range(1, len(period_candles)):
            ret = (period_candles[j]['close'] - period_candles[j-1]['close']) / period_candles[j-1]['close']
            returns.append(ret)
        
        avg_return = sum(returns) / len(returns)
        variance = sum((r - avg_return) ** 2 for r in returns) / len(returns)
        volatility = variance ** 0.5
        
        # Trend strength = abs(price change) / volatility
        trend_strength = abs(price_change_pct) / (volatility * 100) if volatility > 0 else 0
        
        results.append({
            'start_date': period_candles[0]['timestamp'],
            'end_date': period_candles[-1]['timestamp'],
            'start_price': start_price,
            'end_price': end_price,
            'price_change_pct': price_change_pct,
            'volatility': volatility * 100,
            'trend_strength': trend_strength,
            'direction': 'UP' if price_change_pct > 0 else 'DOWN'
        })
    
    return results

def main():
    print("=" * 70)
    print("FINDING BEST TRENDING PERIODS (2005-2026)")
    print("=" * 70)
    
    # Load RELIANCE data (representative of market)
    file_path = os.path.join(DATA_DIR, "RELIANCE.json")
    
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    candles = data['candles']
    print(f"\nTotal candles: {len(candles)}")
    print(f"Date range: {candles[0]['timestamp']} to {candles[-1]['timestamp']}")
    print(f"Price: ₹{candles[0]['close']:.2f} → ₹{candles[-1]['close']:.2f}")
    
    # Analyze 3-month periods (60 trading days)
    print("\nAnalyzing 3-month trending periods...")
    periods = calculate_trend_strength(candles, window=60)
    
    # Sort by trend strength
    sorted_periods = sorted(periods, key=lambda x: x['trend_strength'], reverse=True)
    
    print("\n" + "=" * 70)
    print("TOP 10 STRONGEST TRENDING PERIODS (3 months each)")
    print("=" * 70)
    
    for i, period in enumerate(sorted_periods[:10], 1):
        print(f"\n#{i}: {period['start_date'][:10]} to {period['end_date'][:10]}")
        print(f"   Direction: {period['direction']}")
        print(f"   Price: ₹{period['start_price']:.2f} → ₹{period['end_price']:.2f}")
        print(f"   Change: {period['price_change_pct']:+.1f}%")
        print(f"   Volatility: {period['volatility']:.2f}%")
        print(f"   Trend Strength: {period['trend_strength']:.2f}")
    
    # Find best uptrend and downtrend
    print("\n" + "=" * 70)
    print("RECOMMENDED PERIODS FOR VALIDATION")
    print("=" * 70)
    
    uptrends = [p for p in sorted_periods if p['direction'] == 'UP']
    downtrends = [p for p in sorted_periods if p['direction'] == 'DOWN']
    
    if uptrends:
        best_up = uptrends[0]
        print(f"\n✅ BEST UPTREND:")
        print(f"   Period: {best_up['start_date'][:10]} to {best_up['end_date'][:10]}")
        print(f"   Return: +{best_up['price_change_pct']:.1f}%")
        print(f"   Strength: {best_up['trend_strength']:.2f}")
    
    if downtrends:
        best_down = downtrends[0]
        print(f"\n✅ BEST DOWNTREND:")
        print(f"   Period: {best_down['start_date'][:10]} to {best_down['end_date'][:10]}")
        print(f"   Return: {best_down['price_change_pct']:.1f}%")
        print(f"   Strength: {best_down['trend_strength']:.2f}")
    
    # Recent strong trend
    recent_trends = [p for p in sorted_periods if p['start_date'] >= '2020-01-01']
    if recent_trends:
        recent_strong = sorted(recent_trends, key=lambda x: x['trend_strength'], reverse=True)[0]
        print(f"\n✅ RECENT STRONG TREND (2020+):")
        print(f"   Period: {recent_strong['start_date'][:10]} to {recent_strong['end_date'][:10]}")
        print(f"   Direction: {recent_strong['direction']}")
        print(f"   Return: {recent_strong['price_change_pct']:+.1f}%")
        print(f"   Strength: {recent_strong['trend_strength']:.2f}")
    
    print("\n" + "=" * 70)
    print("NEXT STEP: Validate upgraded strategy on these periods")
    print("=" * 70)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
PATCO Next Train - Main script
Downloads schedules, extracts timetables, and shows next departure times.

Usage:
    python patco.py <station> <direction>
    python patco.py "City Hall" westbound
    python patco.py Lindenwold eastbound
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, time, timedelta
import pandas as pd

# Import our modules
from download_schedules import download_all, OUTPUT_DIR as PDF_DIR
from extract_timetable import extract_all, STATIONS_WESTBOUND, STATIONS_EASTBOUND


SCRIPT_DIR = Path(__file__).parent
CSV_DIR = SCRIPT_DIR / "schedules"


def get_schedule_type_for_date(dt: datetime) -> str:
    """
    Determine which schedule type applies for a given date.
    Returns 'weekday', 'saturday', or 'sunday'.
    """
    weekday = dt.weekday()  # 0=Monday, 6=Sunday
    
    if weekday == 5:
        return 'saturday'
    elif weekday == 6:
        return 'sunday'
    else:
        return 'weekday'


def parse_time(time_str: str) -> time | None:
    """
    Parse time string like '5:30A' or '12:45P' into time object.
    Returns None if invalid.
    """
    if not time_str or not isinstance(time_str, str):
        return None
    
    time_str = time_str.strip()
    if not time_str:
        return None
    
    try:
        suffix = time_str[-1].upper()
        time_part = time_str[:-1]
        
        hour, minute = map(int, time_part.split(':'))
        
        # Convert to 24-hour
        if suffix == 'P' and hour != 12:
            hour += 12
        elif suffix == 'A' and hour == 12:
            hour = 0
        
        return time(hour, minute)
    except:
        return None


def find_special_schedule(target_date: datetime, direction: str) -> pd.DataFrame | None:
    """
    Find a special schedule for a specific date.
    Special schedules have date patterns like '2026-01-25' in their filename.
    """
    date_str = target_date.strftime('%Y-%m-%d')
    
    # Look for files containing the date
    for csv in CSV_DIR.glob(f"*{date_str}*_{direction}.csv"):
        return pd.read_csv(csv)
    
    # Also check for date formats like '2026-01-25'
    alt_patterns = [
        f"*{date_str}*.csv",
        f"*{target_date.strftime('%m-%d')}*.csv",
    ]
    
    for pattern in alt_patterns:
        for csv in CSV_DIR.glob(pattern):
            if direction in csv.name:
                return pd.read_csv(csv)
    
    return None


def load_schedule(schedule_type: str, direction: str) -> pd.DataFrame | None:
    """
    Load the standard schedule CSV for a given type and direction.
    """
    pattern = f"*_{schedule_type}_{direction}.csv"
    csvs = list(CSV_DIR.glob(pattern))
    
    if not csvs:
        return None
    
    # Prefer standard timetable over special schedules
    for csv in csvs:
        if 'Timetable' in csv.name:
            return pd.read_csv(csv)
    
    return pd.read_csv(csvs[0])


def load_schedule_for_date(target_date: datetime, direction: str) -> tuple[pd.DataFrame | None, str]:
    """
    Load the appropriate schedule for a given date.
    Checks for special schedules first, then falls back to standard.
    
    Returns (dataframe, schedule_name)
    """
    # Check for special schedule first
    special_df = find_special_schedule(target_date, direction)
    if special_df is not None:
        return special_df, f"special ({target_date.strftime('%m/%d')})"
    
    # Fall back to standard schedule
    schedule_type = get_schedule_type_for_date(target_date)
    standard_df = load_schedule(schedule_type, direction)
    return standard_df, schedule_type


def find_next_trains(station: str, direction: str, current_time: time, 
                     today: datetime, count: int = 2) -> list[str]:
    """
    Find the next N trains at a station.
    Handles crossing midnight by loading tomorrow's schedule.
    """
    upcoming = []
    
    # Load today's schedule
    today_df, today_schedule = load_schedule_for_date(today, direction)
    
    if today_df is not None and station in today_df.columns:
        for t_str in today_df[station]:
            t = parse_time(t_str)
            if t and t >= current_time:
                upcoming.append(t_str)
                if len(upcoming) >= count:
                    return upcoming
    
    # Need more trains - check tomorrow's schedule
    remaining = count - len(upcoming)
    if remaining > 0:
        tomorrow = today + timedelta(days=1)
        tomorrow_df, tomorrow_schedule = load_schedule_for_date(tomorrow, direction)
        
        if tomorrow_df is not None and station in tomorrow_df.columns:
            for t_str in tomorrow_df[station]:
                t = parse_time(t_str)
                if t:  # All tomorrow's times are valid
                    upcoming.append(f"{t_str} (tomorrow)")
                    if len(upcoming) >= count:
                        break
    
    return upcoming


def normalize_station_name(name: str, stations: list[str]) -> str | None:
    """
    Find matching station name (case-insensitive, partial match).
    """
    name_lower = name.lower().strip()
    
    # Exact match first
    for s in stations:
        if s.lower() == name_lower:
            return s
    
    # Partial match
    for s in stations:
        if name_lower in s.lower() or s.lower() in name_lower:
            return s
    
    return None


def main():
    parser = argparse.ArgumentParser(
        description='Show next PATCO train times',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python patco.py "City Hall" westbound
  python patco.py Lindenwold eastbound
  python patco.py 8th wb

Stations (westbound): Lindenwold → 15/16th & Locust
Stations (eastbound): 15/16th & Locust → Lindenwold
        """
    )
    parser.add_argument('station', help='Station name (partial match OK)')
    parser.add_argument('direction', help='Direction: westbound/wb or eastbound/eb')
    parser.add_argument('-n', '--count', type=int, default=2, help='Number of trains to show')
    parser.add_argument('--refresh', action='store_true', help='Force refresh of schedules')
    parser.add_argument('-q', '--quiet', action='store_true', help='Minimal output')
    
    args = parser.parse_args()
    
    # Normalize direction
    direction = args.direction.lower()
    if direction in ('wb', 'w', 'west', 'westbound'):
        direction = 'westbound'
        stations = STATIONS_WESTBOUND
    elif direction in ('eb', 'e', 'east', 'eastbound'):
        direction = 'eastbound'
        stations = STATIONS_EASTBOUND
    else:
        print(f"Error: Invalid direction '{args.direction}'")
        print("Use: westbound/wb or eastbound/eb")
        return 1
    
    # Normalize station name
    station = normalize_station_name(args.station, stations)
    if not station:
        print(f"Error: Station '{args.station}' not found")
        print(f"\nValid stations ({direction}):")
        for s in stations:
            print(f"  • {s}")
        return 1
    
    now = datetime.now()
    
    if not args.quiet:
        print("="*50)
        print(f"🚇 PATCO Next Train")
        print("="*50)
        print(f"Station: {station}")
        print(f"Direction: {direction.title()}")
        print()
    
    # Download and extract (with caching)
    if not args.quiet:
        print("Checking schedules...")
    
    CSV_DIR.mkdir(exist_ok=True)
    
    # Download PDFs
    pdfs = download_all(skip_existing=not args.refresh, cleanup=True)
    
    # Extract CSVs
    for pdf in pdfs:
        extract_all(pdf, CSV_DIR, skip_existing=not args.refresh, cleanup=True, quiet=True)
    
    # Get schedule info for display
    today_df, today_schedule = load_schedule_for_date(now, direction)
    
    if not args.quiet:
        print(f"Today: {now.strftime('%A')} ({today_schedule} schedule)")
        print(f"Time: {now.strftime('%I:%M %p')}")
        print()
    
    if today_df is None:
        print(f"Error: Could not find schedule for today")
        return 1
    
    # Find next trains (handles tomorrow automatically)
    next_trains = find_next_trains(station, direction, now.time(), now, args.count)
    
    if not next_trains:
        print("No upcoming trains found")
        return 1
    
    # Display results
    if args.quiet:
        for t in next_trains:
            print(t)
    else:
        print(f"🚆 Next trains from {station}:")
        for i, t in enumerate(next_trains, 1):
            print(f"   {i}. {t}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

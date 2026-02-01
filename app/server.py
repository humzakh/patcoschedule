#!/usr/bin/env python3
"""
PATCO Train Schedule Web Server
Flask API for displaying next train times.
"""

from flask import Flask, jsonify, render_template, request
from datetime import datetime, time, timedelta
import zoneinfo
from pathlib import Path
import pandas as pd
import math
import threading
import time as sys_time

# Import from existing modules
from app.utils.download_schedules import download_all
from app.utils.extract_timetable import extract_all, STATIONS_WESTBOUND, STATIONS_EASTBOUND

app = Flask(__name__)


SCRIPT_DIR = Path(__file__).parent
CSV_DIR = SCRIPT_DIR / "schedules" / "parsed_csvs"
PDF_DIR_STANDARD = SCRIPT_DIR / "schedules" / "source_pdfs" / "standard"

# Global standard PDF URL, initially try to find cached one
STANDARD_PDF_URL = "https://www.ridepatco.org/pdf/PATCO_Timetable_2025-12-01.pdf"  # Absolute Fallback
# Try to find a cached standard PDF to use as better fallback
if PDF_DIR_STANDARD.exists():
    cached_standards = list(PDF_DIR_STANDARD.glob("*.pdf"))
    if cached_standards:
        # Use the most recently modified one if multiple exist
        latest = max(cached_standards, key=lambda p: p.stat().st_mtime)
        STANDARD_PDF_URL = f"https://www.ridepatco.org/pdf/{latest.name}"
        print(f"Loaded cached standard PDF URL: {STANDARD_PDF_URL}")

SPECIAL_BASE_URL = "https://www.ridepatco.org/schedules/"

# Station Groups
NJ_STATIONS = [
    "Lindenwold", "Ashland", "Woodcrest", "Haddonfield", "Westmont", 
    "Collingswood", "Ferry Avenue", "Broadway", "City Hall"
]

PA_STATIONS = [
    "Franklin Square", "8th & Market", "9/10th & Locust", 
    "12/13th & Locust", "15/16th & Locust"
]


def get_schedule_type_for_date(dt: datetime) -> str:
    """Determine which schedule type applies for a given date."""
    weekday = dt.weekday()
    if weekday == 5:
        return 'saturday'
    elif weekday == 6:
        return 'sunday'
    else:
        return 'weekday'


def parse_time(time_str: str) -> time | None:
    """Parse time string like '5:30A' or '12:45P' into time object."""
    if not time_str or not isinstance(time_str, str):
        return None
    
    time_str = time_str.strip()
    if not time_str:
        return None
    
    try:
        suffix = time_str[-1].upper()
        time_part = time_str[:-1]
        hour, minute = map(int, time_part.split(':'))
        
        if suffix == 'P' and hour != 12:
            hour += 12
        elif suffix == 'A' and hour == 12:
            hour = 0
        
        return time(hour, minute)
    except:
        return None


def find_special_schedule(target_date: datetime, direction: str) -> pd.DataFrame | None:
    """Find a special schedule for a specific date."""
    date_str = target_date.strftime('%Y-%m-%d')
    
    for csv in CSV_DIR.glob(f"*{date_str}*_{direction}.csv"):
        return pd.read_csv(csv)
    
    alt_patterns = [f"*{date_str}*.csv", f"*{target_date.strftime('%m-%d')}*.csv"]
    for pattern in alt_patterns:
        for csv in CSV_DIR.glob(pattern):
            if direction in csv.name:
                return pd.read_csv(csv)
    
    return None


def load_schedule(schedule_type: str, direction: str) -> pd.DataFrame | None:
    """Load the standard schedule CSV for a given type and direction."""
    pattern = f"*_{schedule_type}_{direction}.csv"
    csvs = list(CSV_DIR.glob(pattern))
    
    if not csvs:
        return None
    
    return pd.read_csv(csvs[0])


def load_schedule_for_date(target_date: datetime, direction: str) -> tuple[pd.DataFrame | None, str, str]:
    """Load the appropriate schedule for a given date. Returns (df, name, url)."""
    special_df = find_special_schedule(target_date, direction)
    if special_df is not None:
        # Try to find the special schedule PDF name
        date_str = target_date.strftime('%Y-%m-%d')
        for csv in CSV_DIR.glob(f"*{date_str}*_{direction}.csv"):
            pdf_name = csv.name.rsplit('_', 2)[0] + '.pdf'
            url = SPECIAL_BASE_URL + pdf_name
            return special_df, f"Special Schedule ({target_date.strftime('%m/%d')})", url
        return special_df, f"Special Schedule ({target_date.strftime('%m/%d')})", ""
    
    schedule_type = get_schedule_type_for_date(target_date)
    standard_df = load_schedule(schedule_type, direction)
    
    # Map schedule types to page numbers
    page_map = {'weekday': '#page=1', 'saturday': '#page=2', 'sunday': '#page=2'}
    url = STANDARD_PDF_URL + page_map.get(schedule_type, '')
    
    return standard_df, schedule_type, url


def find_next_trains(station: str, direction: str, current_time: time, 
                     today: datetime, count: int = 5) -> list[dict]:
    """Find the next N trains at a station with countdown info."""
    upcoming = []
    # Strip seconds/microseconds for comparison to include trains in current minute
    compare_time = current_time.replace(second=0, microsecond=0)
    now_dt = datetime.combine(today.date(), current_time)
    
    today_df, today_schedule, today_url = load_schedule_for_date(today, direction)
    
    if today_df is not None and station in today_df.columns:
        for t_str in today_df[station]:
            t = parse_time(t_str)
            if t and t >= compare_time:
                train_dt = datetime.combine(today.date(), t)
                delta = train_dt - now_dt
                upcoming.append({
                    'time': t_str,
                    'minutes': math.ceil(delta.total_seconds() / 60),
                    'is_tomorrow': False,
                    'schedule': today_schedule,
                    'schedule_url': today_url
                })
                if len(upcoming) >= count:
                    return upcoming
    
    # Check tomorrow if needed
    remaining = count - len(upcoming)
    if remaining > 0:
        tomorrow = today + timedelta(days=1)
        tomorrow_df, tomorrow_schedule, tomorrow_url = load_schedule_for_date(tomorrow, direction)
        
        if tomorrow_df is not None and station in tomorrow_df.columns:
            for t_str in tomorrow_df[station]:
                t = parse_time(t_str)
                if t:
                    train_dt = datetime.combine(tomorrow.date(), t)
                    delta = train_dt - now_dt
                    upcoming.append({
                        'time': t_str,
                        'minutes': math.ceil(delta.total_seconds() / 60),
                        'is_tomorrow': True,
                        'schedule': tomorrow_schedule,
                        'schedule_url': tomorrow_url
                    })
                    if len(upcoming) >= count:
                        return upcoming
    
    return upcoming


def normalize_station_name(name: str, stations: list[str]) -> str | None:
    """Find matching station name (case-insensitive, partial match)."""
    name_lower = name.lower().strip()
    
    for s in stations:
        if s.lower() == name_lower:
            return s
    
    for s in stations:
        if name_lower in s.lower() or s.lower() in name_lower:
            return s
    
    return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/stations')
def get_stations():
    """Return list of all stations."""
    return jsonify({
        'westbound': STATIONS_WESTBOUND,
        'eastbound': STATIONS_EASTBOUND,
        'grouped': [
            {'label': 'New Jersey', 'stations': NJ_STATIONS},
            {'label': 'Philadelphia', 'stations': PA_STATIONS}
        ]
    })


@app.route('/api/next')
def get_next_trains():
    """Return next trains for a station and direction."""
    station_query = request.args.get('station', '')
    direction_arg = request.args.get('direction', 'both').lower()
    count = int(request.args.get('count', 5))
    
    # Use Eastern Time (Philadelphia/NJ)
    timezone = zoneinfo.ZoneInfo("America/New_York")
    now = datetime.now(timezone)

    def get_dir_data(direction):
        stations = STATIONS_WESTBOUND if direction == 'westbound' else STATIONS_EASTBOUND
        station = normalize_station_name(station_query, stations)
        if not station:
            return None
        
        _, schedule_name, schedule_url = load_schedule_for_date(now, direction)
        trains = find_next_trains(station, direction, now.time(), now, count)
        
        return {
            'station': station,
            'direction': direction,
            'schedule': schedule_name,
            'schedule_url': schedule_url,
            'trains': trains
        }

    if direction_arg != 'both':
        # Single direction (legacy or specific)
        if direction_arg in ('wb', 'w', 'west', 'westbound'):
             d = 'westbound'
        else:
             d = 'eastbound'
        
        data = get_dir_data(d)
        if not data:
             return jsonify({'error': f"Station '{station_query}' not found"}), 404
        
        # Add root fields expected by legacy checks if any
        data['current_time'] = now.strftime('%I:%M %p')
        data['server_time_iso'] = now.isoformat()
        return jsonify(data)
    
    # Both directions
    east_data = get_dir_data('eastbound')
    west_data = get_dir_data('westbound')
    
    if not east_data and not west_data:
        # Station invalid
        return jsonify({'error': f"Station '{station_query}' not found"}), 404
        
    return jsonify({
        'server_time_iso': now.isoformat(),
        'eastbound': east_data,
        'westbound': west_data
    })


def perform_refresh():
    """Download and extract latest schedules (core logic)."""
    print(f"[{datetime.now()}] Refreshing schedules...")
    CSV_DIR.mkdir(exist_ok=True)
    pdfs = download_all(skip_existing=False, cleanup=False)
    
    # Update standard URL
    global STANDARD_PDF_URL
    for pdf in pdfs:
        if pdf['type'] == 'standard':
            STANDARD_PDF_URL = pdf['url']
        extract_all(pdf['local_path'], CSV_DIR, skip_existing=False, cleanup=False, quiet=True)
    
    print(f"[{datetime.now()}] Refresh complete. {len(pdfs)} PDFs processed.")
    return len(pdfs)


@app.route('/api/refresh')
def refresh_schedules():
    """Download and extract latest schedules."""
    count = perform_refresh()
    return jsonify({'status': 'ok', 'pdfs': count})


def scheduler_loop():
    """Background loop to refresh schedules every hour."""
    print("Scheduler thread started. Will refresh every hour.")
    while True:
        # Sleep for 1 hour (3600 seconds)
        sleep_seconds = 3600
        print(f"[{datetime.now()}] Scheduler sleeping for 1 hour...")
        
        sys_time.sleep(sleep_seconds)
        
        try:
            perform_refresh()
        except Exception as e:
            print(f"Error in scheduled refresh: {e}")


def start_scheduler():
    """Start the background scheduler thread."""
    thread = threading.Thread(target=scheduler_loop, daemon=True)
    thread.start()


if __name__ == '__main__':
    import os
    
    # Only run initialization in the reloader process (or if debug is off)
    # This prevents running twice (once in monitoring process, once in worker)
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        # Ensure schedules are ready
        CSV_DIR.mkdir(parents=True, exist_ok=True)
        pdfs = download_all(skip_existing=True, cleanup=False)
        
        # Update standard URL
        for pdf in pdfs:
            if pdf['type'] == 'standard':
                STANDARD_PDF_URL = pdf['url']
                print(f"   Using Standard Schedule: {STANDARD_PDF_URL}")
            extract_all(pdf['local_path'], CSV_DIR, skip_existing=True, cleanup=False, quiet=True)
        
        print("🚇 PATCO Schedule Server starting...")
        start_scheduler()
        print("   Open http://localhost:8080 in your browser")

    app.run(host='0.0.0.0', debug=True, port=8080)

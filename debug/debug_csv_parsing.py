
import pandas as pd
from pathlib import Path
from datetime import time

CSV_DIR = Path(__file__).parent.parent / "app" / "schedules" / "parsed_csvs"

def parse_time(time_str: str) -> time | None:
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
    except Exception as e:
        print(f"Failed to parse '{time_str}': {e}")
        return None

def debug_sunday_parsing():
    # Find Sunday Eastbound CSV
    pattern = "*_sunday_eastbound.csv"
    csvs = list(CSV_DIR.glob(pattern))
    if not csvs:
        print("No Sunday Eastbound CSV found!")
        return

    csv = csvs[0]
    print(f"Loading {csv}...")
    df = pd.read_csv(csv)
    
    col = "15/16th & Locust"
    if col not in df.columns:
        print(f"Column '{col}' not found. Columns: {df.columns}")
        return

    print(f"\nInspecting '{col}' column:")
    for i, t_str in enumerate(df[col]):
        t = parse_time(t_str)
        if i < 5 or i > 60: # Print start and end
            print(f"Row {i}: {repr(t_str)} -> {t}")
        if i == 5: print("...")

if __name__ == "__main__":
    debug_sunday_parsing()

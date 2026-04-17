#!/usr/bin/env python3
"""
Generate JSON schedule data from PATCO PDFs.
This script extracts timetables and converts them into structured JSON files for the static SPA.
"""

import json
import pandas as pd
import re
import sys
from datetime import datetime
from pathlib import Path

# Add the project root to the python path so we can import from scripts
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.download_schedules import download_all
from scripts.extract_timetable import extract_all, STATIONS_WESTBOUND, STATIONS_EASTBOUND


def time_to_minutes(time_str):
    if not time_str:
        return None
    try:
        suffix = time_str[-1]
        hours_str, minutes_str = time_str[:-1].split(':')
        hours = int(hours_str)
        minutes = int(minutes_str)
        if suffix == 'P' and hours != 12:
            hours += 12
        if suffix == 'A' and hours == 12:
            hours = 0
        return hours * 60 + minutes
    except:
        return None


def whatthefuck(rows):
    """
    Named as such by request of Austin.
 
    Detect and correct AM/PM typos in schedule rows.
    If a trip is > 10 hours away from neighbors but flipping AM/PM makes it normal, flip it.
    """
    if len(rows) < 2:
        return rows
 
    def get_first_time(row):
        if not row: return None
        for val in row:
            if val: return val
        return None
 
    new_rows = [rows[0]] # header
    trips = [r[:] for r in rows[1:]] # Copy trips
 
    for i in range(len(trips)):
        curr_row = trips[i]
        prev_row = trips[i-1] if i > 0 else None
        next_row = trips[i+1] if i < len(trips) - 1 else None
 
        curr_time_str = get_first_time(curr_row)
        if not curr_time_str:
            new_rows.append(curr_row)
            continue

        curr_mins = time_to_minutes(curr_time_str)
        if curr_mins is None:
            new_rows.append(curr_row)
            continue

        # Check neighbors
        prev_mins = time_to_minutes(get_first_time(prev_row)) if prev_row else None
        next_mins = time_to_minutes(get_first_time(next_row)) if next_row else None

        # Try flipping
        suffix = curr_time_str[-1]
        if suffix not in ('A', 'P'):
            new_rows.append(curr_row)
            continue

        flipped_suffix = 'P' if suffix == 'A' else 'A'
        flipped_time_str = curr_time_str[:-1] + flipped_suffix
        flipped_mins = time_to_minutes(flipped_time_str)

        should_flip = False

        # Logic: If current jump is huge (>10h) but flipped would be small (<2h)
        # 600 mins = 10 hours
        # 120 mins = 2 hours

        if prev_mins is not None:
            gap = (curr_mins - prev_mins) % 1440
            flipped_gap = (flipped_mins - prev_mins) % 1440

            if gap > 600 and flipped_gap < 120:
                # Potential typo. Confirm with next row if possible.
                if next_mins is not None:
                    next_gap = (next_mins - curr_mins) % 1440
                    flipped_next_gap = (next_mins - flipped_mins) % 1440
                    if next_gap > 600 and flipped_next_gap < 120:
                        should_flip = True
                else:
                    # No next row, trust the prev gap improvement
                    should_flip = True
        elif next_mins is not None:
            # No previous row, rely on next row gap
            gap = (next_mins - curr_mins) % 1440
            flipped_gap = (next_mins - flipped_mins) % 1440
            if gap > 600 and flipped_gap < 120:
                should_flip = True

        if should_flip:
            print(f"  [whatthefuck] Fixing typo: {curr_time_str} -> {flipped_time_str}")
            # Apply to all columns in this row
            for j in range(len(curr_row)):
                val = curr_row[j]
                if val and (val.endswith('A') or val.endswith('P')):
                    s = val[-1]
                    f = 'P' if s == 'A' else 'A'
                    curr_row[j] = val[:-1] + f

        new_rows.append(curr_row)

    return new_rows


def main():
    print("=" * 60)
    print("PATCO Data Generator")
    print("=" * 60)

    # 1. Paths
    data_dir = PROJECT_ROOT / "data"
    schedules_dir = data_dir / "schedules"
    csv_dir = schedules_dir / "parsed_csvs"

    data_dir.mkdir(parents=True, exist_ok=True)
    csv_dir.mkdir(parents=True, exist_ok=True)

    # 2. Download PDFs
    print("\n--- Downloading Schedules ---")
    pdfs = download_all(skip_existing=True, cleanup=True)

    if not pdfs:
        print("No new PDFs to process. (Or no PDFs exist).")
        # We still want to build the JSON data even if PDFs didn't change (e.g., initial run)
        # So we continue below.

    # Find the standard URL for reference
    standard_url = None
    standard_pdf_filename = None
    standard_pdf_json = data_dir / "standard_pdf.json"

    for pdf in (pdfs or []):
        if isinstance(pdf, dict) and pdf.get('type') == 'standard':
            standard_url = pdf.get('url')
            standard_pdf_filename = pdf.get('filename')

    if standard_url:
        # Save for future fallback use
        with open(standard_pdf_json, 'w') as f:
            json.dump({'url': standard_url, 'filename': standard_pdf_filename}, f, indent=2)
    else:
        # Fallback: detect from whatever standard PDF exists on disk
        std_dir = schedules_dir / "source_pdfs" / "standard"
        if std_dir.exists():
            std_pdfs = list(std_dir.glob("*.pdf"))
            if std_pdfs:
                standard_pdf_filename = std_pdfs[0].name
                standard_url = f"https://www.ridepatco.org/pdf/{standard_pdf_filename}"
        # Then try last saved config
        if standard_url is None and standard_pdf_json.exists():
            with open(standard_pdf_json) as f:
                saved = json.load(f)
                standard_url = saved.get('url')
                standard_pdf_filename = saved.get('filename')

    # 3. Extract CSVs from PDFs
    print("\n--- Extracting CSVs ---")

    # First, clear the entire parsed_csvs directory so we don't carry over old schedules indefinitely
    for old_csv in csv_dir.glob("*.csv"):
         old_csv.unlink()

    # Loop over standard and special directories to extract everything
    pdf_source_dir = schedules_dir / "source_pdfs"
    csv_paths = []
    if pdf_source_dir.exists():
        for pdf_file in pdf_source_dir.rglob("*.pdf"):
             csvs = extract_all(pdf_file, csv_dir, skip_existing=True, cleanup=False, quiet=True)
             csv_paths.extend(csvs)

    print("\nExtraction complete.")

    # 4. Convert to JSON
    print("\n--- Generating JSON ---")

    # Read all CSVs into a structured dictionary

    schedules = {
        'standard': {'weekday': None, 'saturday': None, 'sunday': None},
        'special': {}
    }

    # Track the standard prefix from the standard PDF
    if standard_pdf_filename:
         standard_prefix = standard_pdf_filename.replace('.pdf', '')
    else:
         standard_prefix = "PATCO_Timetable"

    csv_files = list(csv_dir.glob("*.csv"))
    print(f"\nFound {len(csv_files)} total CSV files.")

    # Pre-analyze special schedule sections to handle redundant suffixes
    # Map of { pdf_stem: {section_names} }
    special_meta = {}
    day_suffixes = ["saturday", "sunday", "weekday"]
    
    for csv_file in csv_files:
        name = csv_file.stem
        if name == "patco_data" or (standard_prefix and name.startswith(standard_prefix)):
            continue
        
        parts = name.split("_")
        for d in ["eastbound", "westbound", "schedule"]:
            if d in parts: parts.remove(d)
            
        if parts and parts[-1].lower() in day_suffixes:
            section = parts[-1].lower()
            stem = "_".join(parts[:-1])
            if stem not in special_meta: special_meta[stem] = set()
            special_meta[stem].add(section)

    for csv_file in csv_files:
        name = csv_file.stem
        if name == "patco_data":
            continue

        # Load CSV data
        df = pd.read_csv(csv_file).fillna("")
        data_list = df.values.tolist() if not df.empty else []

        # Apply whatthefuck to fix typos (it expects headers + rows)
        processed_data = whatthefuck([list(df.columns)] + data_list)
        
        # Store as a structured object
        final_data = {
            'stations': processed_data[0],
            'times': processed_data[1:]
        }

        # Determine if this is a standard schedule or special schedule
        if standard_prefix and name.startswith(standard_prefix):
             # Standard schedule (e.g. PATCO_Timetable_2025-12-01_weekday_eastbound)
             direction = 'eastbound' if 'eastbound' in name else 'westbound'
             parts = name.replace(standard_prefix + "_", "").split("_")
             schedule_type = parts[0]

             if schedules['standard'].get(schedule_type) is None:
                  schedules['standard'][schedule_type] = {'url': '', 'westbound': None, 'eastbound': None}
             schedules['standard'][schedule_type][direction] = final_data

        else:
             # Special schedule
             direction = 'eastbound' if 'eastbound' in name else 'westbound'
             parts = name.split("_")
             for d in ["eastbound", "westbound", "schedule"]:
                 if d in parts: parts.remove(d)
             
             section = parts[-1].lower() if parts and parts[-1].lower() in day_suffixes else None
             stem = "_".join(parts[:-1]) if section else "_".join(parts)
             
             # Strip suffix if it's the only section in that PDF group
             if section and stem in special_meta and len(special_meta[stem]) <= 1:
                 special_key = stem
             else:
                 special_key = "_".join(parts)

             if special_key not in schedules['special']:
                  # Look up the URL for this special schedule
                  special_url = "https://www.ridepatco.org/schedules/"
                  for pdf in (pdfs or []):
                      if isinstance(pdf, dict) and pdf.get('type') == 'special':
                          if pdf.get('filename', '').replace('.pdf', '').startswith(stem):
                              special_url = pdf.get('url')
                              break
                  
                  schedules['special'][special_key] = {'url': special_url, 'westbound': None, 'eastbound': None}

             schedules['special'][special_key][direction] = final_data

    # Add URL to each standard schedule type
    if standard_url:
        page_map = {'weekday': '#page=1', 'saturday': '#page=2', 'sunday': '#page=2'}
        for typ in schedules['standard']:
            if schedules['standard'][typ]:
                schedules['standard'][typ]['url'] = standard_url + page_map.get(typ, '')

    # Filter out any standard types that weren't found
    schedules['standard'] = {k: v for k, v in schedules['standard'].items() if v is not None}

    # Sort special schedules by key (date), descending
    # Use a key that sorts by the date string found in the filename
    def get_sort_key(k):
        match = re.search(r'(\d{4}-\d{2}-\d{2})', k)
        return match.group(1) if match else k

    schedules['special'] = dict(sorted(schedules['special'].items(), key=lambda x: get_sort_key(x[0]), reverse=True))

    output_data = {
        'last_updated': datetime.now().isoformat(),
        'schedules': schedules
    }

    json_path = data_dir / "patco_data.json"
    with open(json_path, 'w') as f:
        json.dump(output_data, f, indent=2)

    print(f"Generated JSON successfully at: {json_path}")

if __name__ == '__main__':
    main()

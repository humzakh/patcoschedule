#!/usr/bin/env python3
"""
Generate JSON schedule data from PATCO PDFs.
This script extracts timetables and converts them into structured JSON files for the static SPA.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, date

# Add the project root to the python path so we can import from app.utils
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.utils.download_schedules import download_all
from app.utils.extract_timetable import extract_all


def main():
    print("=" * 60)
    print("PATCO Data Generator")
    print("=" * 60)
    
    # 1. Paths
    app_dir = project_root / "app"
    data_dir = project_root / "data"
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
    import pandas as pd
    
    schedules = {
        'standard': {},
        'special': {}
    }
    
    # Track the standard prefix from the standard PDF
    if standard_pdf_filename:
         standard_prefix = standard_pdf_filename.replace('.pdf', '')
    else:
         standard_prefix = "PATCO_Timetable"

    for csv_file in csv_dir.glob("*.csv"):
        df = pd.read_csv(csv_file).fillna("")
        # Convert dataframe to list of dicts or list of lists
        # For compactness, orient="list" or orient="records"
        # We will keep it simple as a 2D array: header first, then rows
        data = [list(df.columns)] + df.values.tolist()
        
        name = csv_file.stem
        direction = 'eastbound' if 'eastbound' in name else 'westbound'
        
        # Categorize
        if name.startswith(standard_prefix):
             # Standard schedule (e.g. PATCO_Timetable_2025-12-01_weekday_eastbound)
             # Extract the schedule type (weekday, saturday, sunday)
             parts = name.replace(standard_prefix + "_", "").split("_")
             schedule_type = parts[0]
             
             if direction not in schedules['standard']:
                  schedules['standard'][direction] = {}
             schedules['standard'][direction][schedule_type] = data
             
        else:
             # Special schedule
             # E.g., TW_2026-02-04_schedule_eastbound or 2026-02-16_PresidentsDay_schedule_westbound
             # We want to key this by the date/prefix so the frontend can look it up
             
             # The PDF parser outputs special schedules with the PDF stem
             pdf_stem_parts = name.split("_")
             if "eastbound" in pdf_stem_parts:
                 pdf_stem_parts.remove("eastbound")
             if "westbound" in pdf_stem_parts:
                 pdf_stem_parts.remove("westbound")
             if "schedule" in pdf_stem_parts:
                 pdf_stem_parts.remove("schedule")
                 
             special_key = "_".join(pdf_stem_parts)
             
             if special_key not in schedules['special']:
                  schedules['special'][special_key] = {}
                  
                  # Look up the URL for this special schedule
                  special_url = "https://www.ridepatco.org/schedules/"
                  for pdf in (pdfs or []):
                      if isinstance(pdf, dict) and pdf.get('type') == 'special':
                          if special_key.startswith(pdf.get('filename', '').replace('.pdf', '')):
                              special_url = pdf.get('url')
                              break
                  schedules['special'][special_key]['url'] = special_url
                  
             schedules['special'][special_key][direction] = data


    from app.utils.extract_timetable import STATIONS_WESTBOUND, STATIONS_EASTBOUND
    
    output_data = {
        'last_updated': datetime.now().isoformat(),
        'standard_url': standard_url,
        'stations': {
            'westbound': STATIONS_WESTBOUND,
            'eastbound': STATIONS_EASTBOUND
        },
        'schedules': schedules
    }
    
    json_path = data_dir / "patco_data.json"
    with open(json_path, 'w') as f:
        json.dump(output_data, f, indent=2)
        
    print(f"Generated JSON successfully at: {json_path}")
    
if __name__ == '__main__':
    main()

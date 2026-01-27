#!/usr/bin/env python3
"""
Extract timetables from PATCO PDF files.
Features:
- Dynamic column boundary detection
- Caching (skips if CSVs already exist for PDF)
- Cleans up CSVs older than 7 days

Usage:
    python extract_timetable.py <pdf_file> [-o output_dir]
"""

import argparse
import pdfplumber
import pandas as pd
from pathlib import Path
import re
from datetime import datetime, timedelta


STATIONS_WESTBOUND = [
    "Lindenwold", "Ashland", "Woodcrest", "Haddonfield", "Westmont",
    "Collingswood", "Ferry Avenue", "Broadway", "City Hall", "Franklin Square",
    "8th & Market", "9/10th & Locust", "12/13th & Locust", "15/16th & Locust"
]
STATIONS_EASTBOUND = list(reversed(STATIONS_WESTBOUND))
MAX_AGE_DAYS = 7


def cleanup_old_files(directory: Path, pattern: str = "*.csv", max_age_days: int = MAX_AGE_DAYS) -> int:
    """Delete files older than max_age_days. Returns count deleted."""
    if not directory.exists():
        return 0
    
    deleted = 0
    cutoff = datetime.now() - timedelta(days=max_age_days)
    
    for f in directory.glob(pattern):
        if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            print(f"  Deleting old: {f.name}")
            f.unlink()
            deleted += 1
    
    return deleted


def check_cache(pdf_path: Path, output_dir: Path) -> bool:
    """
    Check if CSVs already exist for this PDF.
    Returns True if cached (extraction can be skipped).
    """
    prefix = pdf_path.stem
    csv_pattern = f"{prefix}_*.csv"
    existing = list(output_dir.glob(csv_pattern))
    return len(existing) > 0


def detect_column_centers(times: list[dict], min_gap: float = 12) -> list[float]:
    """
    Detect column centers by clustering x-positions.
    Returns list of column center x-coordinates.
    """
    if not times:
        return []
    
    x_positions = sorted(set(t['x'] for t in times))
    if not x_positions:
        return []
    
    # Group nearby positions into columns and compute centers
    column_centers = []
    cluster = [x_positions[0]]
    
    for i in range(1, len(x_positions)):
        gap = x_positions[i] - x_positions[i-1]
        if gap > min_gap:
            # New column - save center of previous cluster
            column_centers.append(sum(cluster) / len(cluster))
            cluster = [x_positions[i]]
        else:
            cluster.append(x_positions[i])
    
    # Don't forget the last cluster
    column_centers.append(sum(cluster) / len(cluster))
    
    return column_centers


def extract_times_with_position(page, y_start: float = 0, y_end: float = None):
    """
    Extract time values and closed-station markers with their positions from a page region.
    The à character marks closed stations in the PDF.
    Also handles times without AM/PM suffix (e.g., "12:05" instead of "12:05A").
    """
    if y_end is None:
        y_end = page.height
    
    words = page.extract_words(x_tolerance=2, y_tolerance=2)
    # Match times with AM/PM suffix
    time_pattern_with_suffix = re.compile(r'^\d{1,2}:\d{2}[AP]$')
    # Match times without AM/PM suffix (some PDFs have bare times like "12:05")
    time_pattern_bare = re.compile(r'^\d{1,2}:\d{2}$')
    
    items = []
    for word in words:
        if word['top'] < y_start or word['top'] > y_end:
            continue
        
        text = word['text']
        if time_pattern_with_suffix.match(text):
            items.append({'text': text, 'x': word['x0'], 'y': word['top'], 'type': 'time'})
        elif time_pattern_bare.match(text):
            # Time without suffix - mark for later suffix inference
            items.append({'text': text, 'x': word['x0'], 'y': word['top'], 'type': 'time', 'needs_suffix': True})
        elif text == 'à' or text == '→':  # Arrow marker for closed station
            items.append({'text': '', 'x': word['x0'], 'y': word['top'], 'type': 'closed'})
    
    return items


def group_times_by_row(times: list[dict], y_tolerance: float = 6) -> list[list[dict]]:
    """Group times into rows based on y position."""
    if not times:
        return []
    
    sorted_times = sorted(times, key=lambda t: (t['y'], t['x']))
    rows = []
    current_row = []
    current_y = None
    
    for t in sorted_times:
        if current_y is None:
            current_y = t['y']
            current_row = [t]
        elif abs(t['y'] - current_y) <= y_tolerance:
            current_row.append(t)
        else:
            if current_row:
                rows.append(sorted(current_row, key=lambda x: x['x']))
            current_row = [t]
            current_y = t['y']
    
    if current_row:
        rows.append(sorted(current_row, key=lambda x: x['x']))
    
    return rows


def find_nearest_column(x: float, column_centers: list[float]) -> int:
    """Find the column with center nearest to x position."""
    if not column_centers:
        return -1
    
    min_dist = float('inf')
    nearest = -1
    
    for i, center in enumerate(column_centers):
        dist = abs(x - center)
        if dist < min_dist:
            min_dist = dist
            nearest = i
    
    return nearest


def infer_suffix_from_row(row: list[dict]) -> str:
    """
    Infer AM/PM suffix from times in a row that have suffixes.
    Returns 'A' or 'P', defaults to 'A' if none found.
    """
    for item in row:
        if item.get('type') == 'time' and not item.get('needs_suffix'):
            text = item.get('text', '')
            if text.endswith('A'):
                return 'A'
            elif text.endswith('P'):
                return 'P'
    return 'A'  # Default to AM if no suffix found


def assign_times_to_columns(row: list[dict], column_centers: list[float]) -> list[str]:
    """
    Assign times to columns using nearest-neighbor matching.
    Each item (time or closed marker) is assigned to its closest column center.
    Closed markers result in empty strings.
    Also handles times without AM/PM suffix by inferring from other times in the row.
    """
    num_cols = len(column_centers)
    result = [''] * num_cols
    
    if not row:
        return result
    
    # Infer suffix for times that need it
    inferred_suffix = infer_suffix_from_row(row)
    
    # Sort items by x position
    sorted_items = sorted(row, key=lambda t: t['x'])
    
    # Track which columns have been assigned
    used_columns = set()
    
    for item in sorted_items:
        # Find nearest unused column
        best_col = -1
        best_dist = float('inf')
        
        for i, center in enumerate(column_centers):
            if i not in used_columns:
                dist = abs(item['x'] - center)
                if dist < best_dist:
                    best_dist = dist
                    best_col = i
        
        if best_col >= 0:
            # Only assign text for 'time' type, not 'closed'
            if item.get('type') == 'time':
                time_text = item['text']
                # Add inferred suffix if needed
                if item.get('needs_suffix'):
                    time_text = time_text + inferred_suffix
                result[best_col] = time_text
            # For 'closed' markers, leave as empty string
            used_columns.add(best_col)
    
    return result


def extract_column_centers_from_headers(page, x_start: float, x_end: float, 
                                          header_y_start: float = 300, header_y_end: float = 400) -> list[float]:
    """
    Extract column center x-positions from the header row.
    Headers are rotated text so we detect columns by clustering x-positions.
    """
    words = page.extract_words(x_tolerance=2, y_tolerance=2)
    
    # Get header words in the specified x range
    header_x = [w['x0'] for w in words 
                if x_start <= w['x0'] <= x_end and header_y_start <= w['top'] <= header_y_end]
    
    if not header_x:
        return []
    
    # Cluster header x-positions to find column centers
    # Headers are spaced roughly 37 pixels apart
    from collections import defaultdict
    columns = defaultdict(list)
    for x in header_x:
        col_x = round(x / 37) * 37  # Group by ~37px spacing
        columns[col_x].append(x)
    
    # Return sorted column centers
    return sorted(columns.keys())


def extract_schedule_from_region(page, y_start: float, y_end: float, 
                                  page_midpoint: float) -> tuple[list, list, int, int]:
    """
    Extract westbound and eastbound schedules from a page region.
    Uses header x-positions as column centers for accurate column assignment.
    """
    # Get header column centers
    wb_header_centers = extract_column_centers_from_headers(page, 0, page_midpoint)
    eb_header_centers = extract_column_centers_from_headers(page, page_midpoint, page.width)
    
    # Extract times and closed markers
    items = extract_times_with_position(page, y_start, page.height - 40)
    
    wb_items = [t for t in items if t['x'] < page_midpoint]
    eb_items = [t for t in items if t['x'] >= page_midpoint]
    
    wb_rows = group_times_by_row(wb_items)
    eb_rows = group_times_by_row(eb_items)
    
    # Use header centers if available, otherwise fall back to fullest row
    def get_column_centers(header_centers, rows):
        if header_centers:
            return header_centers
        # Fallback: use fullest row
        if not rows:
            return []
        fullest_row = max(rows, key=len)
        return detect_column_centers(fullest_row)
    
    wb_columns = get_column_centers(wb_header_centers, wb_rows)
    eb_columns = get_column_centers(eb_header_centers, eb_rows)
    
    westbound_data = []
    for row in wb_rows:
        if len(row) >= 5:
            westbound_data.append(assign_times_to_columns(row, wb_columns))
    
    eastbound_data = []
    for row in eb_rows:
        if len(row) >= 5:
            eastbound_data.append(assign_times_to_columns(row, eb_columns))
    
    return westbound_data, eastbound_data, len(wb_columns), len(eb_columns)


def rows_to_dataframe(rows: list[list[str]], station_names: list[str]) -> pd.DataFrame:
    """Convert rows to DataFrame with station names as columns."""
    if not rows:
        return pd.DataFrame()
    
    num_cols = len(rows[0]) if rows else 0
    columns = station_names[:num_cols] if num_cols <= len(station_names) else [f"Station_{i+1}" for i in range(num_cols)]
    return pd.DataFrame(rows, columns=columns)


def detect_page_sections(page) -> list[dict]:
    """Detect sections on a page (e.g., Saturday/Sunday split)."""
    text = page.extract_text() or ""
    sections = []
    
    if "SATURDAY" in text.upper() and "SUNDAY" in text.upper():
        mid_y = page.height / 2
        sections.append({'name': 'saturday', 'y_start': 40, 'y_end': mid_y})
        sections.append({'name': 'sunday', 'y_start': mid_y + 20, 'y_end': page.height - 40})
    elif "SATURDAY" in text.upper():
        sections.append({'name': 'saturday', 'y_start': 40, 'y_end': page.height - 40})
    elif "SUNDAY" in text.upper():
        sections.append({'name': 'sunday', 'y_start': 40, 'y_end': page.height - 40})
    elif "MONDAY" in text.upper() and "FRIDAY" in text.upper():
        header_height = page.height * 0.24
        sections.append({'name': 'weekday', 'y_start': header_height, 'y_end': page.height - 40})
    else:
        sections.append({'name': 'schedule', 'y_start': 40, 'y_end': page.height - 40})
    
    return sections


def extract_timetables(pdf_path: str) -> dict[str, pd.DataFrame]:
    """Extract all timetables from a PATCO PDF."""
    results = {}
    
    with pdfplumber.open(pdf_path) as pdf:
        page_width = pdf.pages[0].width
        mid_x = page_width / 2
        
        for page_num, page in enumerate(pdf.pages, start=1):
            sections = detect_page_sections(page)
            
            for section in sections:
                wb_rows, eb_rows, wb_cols, eb_cols = extract_schedule_from_region(
                    page, section['y_start'], section['y_end'], mid_x
                )
                
                if wb_rows:
                    df = rows_to_dataframe(wb_rows, STATIONS_WESTBOUND)
                    results[f"{section['name']}_westbound"] = df
                
                if eb_rows:
                    df = rows_to_dataframe(eb_rows, STATIONS_EASTBOUND)
                    results[f"{section['name']}_eastbound"] = df
    
    return results


def save_timetables(timetables: dict[str, pd.DataFrame], output_dir: Path, prefix: str) -> list[Path]:
    """Save timetables to CSV files."""
    output_dir.mkdir(exist_ok=True)
    saved = []
    
    for name, df in timetables.items():
        filename = f"{prefix}_{name}.csv"
        filepath = output_dir / filename
        df.to_csv(filepath, index=False)
        saved.append(filepath)
    
    return saved


def extract_all(pdf_path: Path, output_dir: Path, skip_existing: bool = True, 
                cleanup: bool = True, quiet: bool = False) -> list[Path]:
    """
    Extract timetables from a PDF.
    Returns list of CSV paths.
    """
    output_dir.mkdir(exist_ok=True)
    
    # Cleanup old files
    if cleanup:
        deleted = cleanup_old_files(output_dir)
        if deleted and not quiet:
            print(f"Cleaned up {deleted} old file(s)")
    
    # Check cache
    if skip_existing and check_cache(pdf_path, output_dir):
        if not quiet:
            print(f"Already extracted: {pdf_path.name}")
        prefix = pdf_path.stem
        return list(output_dir.glob(f"{prefix}_*.csv"))
    
    # Extract
    if not quiet:
        print(f"Extracting: {pdf_path.name}")
    
    timetables = extract_timetables(str(pdf_path))
    
    if not timetables:
        return []
    
    prefix = pdf_path.stem
    saved = save_timetables(timetables, output_dir, prefix)
    
    if not quiet:
        for f in saved:
            print(f"  Created: {f.name}")
    
    return saved


def main():
    parser = argparse.ArgumentParser(description='Extract PATCO timetables from PDF')
    parser.add_argument('pdf_file', help='Path to the PDF file')
    parser.add_argument('-o', '--output', default='.', help='Output directory')
    parser.add_argument('--no-cache', action='store_true', help='Force re-extraction')
    parser.add_argument('--no-cleanup', action='store_true', help='Skip cleanup of old files')
    
    args = parser.parse_args()
    
    pdf_path = Path(args.pdf_file)
    if not pdf_path.exists():
        print(f"Error: {pdf_path} not found")
        return 1
    
    output_dir = Path(args.output)
    
    print("="*60)
    print("PATCO Timetable Extraction")
    print("="*60 + "\n")
    
    saved = extract_all(
        pdf_path, output_dir,
        skip_existing=not args.no_cache,
        cleanup=not args.no_cleanup
    )
    
    print(f"\n✅ {len(saved)} CSV file(s) ready")
    return 0


if __name__ == "__main__":
    exit(main())

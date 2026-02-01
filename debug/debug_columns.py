#!/usr/bin/env python3
"""
Debug script to analyze the exact x-positions of columns in the PATCO timetable PDF.
"""

import pdfplumber
from pathlib import Path
from collections import defaultdict


def analyze_column_positions(pdf_path: str):
    """
    Analyze x-positions of times to determine column boundaries.
    """
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[1]  # Page 2 (Saturday/Sunday)
        
        print(f"Page size: {page.width} x {page.height}")
        print(f"Mid point: {page.width / 2}")
        
        # Extract all words with positions
        words = page.extract_words(x_tolerance=2, y_tolerance=2)
        
        # Find all time values
        import re
        time_pattern = re.compile(r'^\d{1,2}:\d{2}[AP]$')
        
        # Group times by their x position (rounded to nearest 10)
        x_positions = defaultdict(list)
        
        for word in words:
            if time_pattern.match(word['text']):
                x_rounded = round(word['x0'] / 5) * 5  # Round to nearest 5
                x_positions[x_rounded].append(word['text'])
        
        print("\n=== X-Position Analysis (Page 2 - Saturday) ===")
        print("X Position | Count | Sample Times")
        print("-" * 60)
        
        for x in sorted(x_positions.keys()):
            samples = x_positions[x][:3]
            mid = page.width / 2
            side = "WB" if x < mid else "EB"
            print(f"{x:8.1f} ({side}) | {len(x_positions[x]):4d} | {', '.join(samples)}")
        
        # Find distinct column boundaries
        print("\n=== Distinct Column X Ranges ===")
        all_x = sorted(x_positions.keys())
        
        # Group nearby x positions into columns
        columns = []
        current_col = [all_x[0]]
        
        for x in all_x[1:]:
            if x - current_col[-1] < 15:  # Within 15 pixels = same column
                current_col.append(x)
            else:
                columns.append(current_col)
                current_col = [x]
        columns.append(current_col)
        
        print(f"\nFound {len(columns)} distinct columns:")
        for i, col in enumerate(columns):
            x_start = min(col)
            x_end = max(col)
            mid = page.width / 2
            side = "WB" if x_start < mid else "EB"
            count = sum(len(x_positions[x]) for x in col)
            print(f"  Col {i+1:2d}: x={x_start:6.1f}-{x_end:6.1f} ({side}) | {count:3d} times")


def extract_with_column_boundaries(pdf_path: str):
    """
    Extract times using fixed column boundaries.
    """
    import re
    
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[1]
        
        words = page.extract_words(x_tolerance=2, y_tolerance=2)
        time_pattern = re.compile(r'^\d{1,2}:\d{2}[AP]$')
        
        # Get all times with positions
        times = []
        for word in words:
            if time_pattern.match(word['text']):
                times.append({
                    'text': word['text'],
                    'x': word['x0'],
                    'y': word['top']
                })
        
        # Group by y (row)
        from collections import defaultdict
        rows = defaultdict(list)
        for t in times:
            y_rounded = round(t['y'] / 8) * 8
            rows[y_rounded].append(t)
        
        print("\n=== Sample Rows (First 10 data rows from Saturday) ===")
        
        sorted_y = sorted(rows.keys())
        mid_x = page.width / 2
        
        # Skip header rows, show first 10 data rows
        data_rows = [y for y in sorted_y if y > 60][:10]
        
        for y in data_rows:
            row_times = sorted(rows[y], key=lambda t: t['x'])
            
            # Split into WB and EB
            wb_times = [(t['x'], t['text']) for t in row_times if t['x'] < mid_x]
            eb_times = [(t['x'], t['text']) for t in row_times if t['x'] >= mid_x]
            
            print(f"\nY={y:.0f}:")
            print(f"  WB ({len(wb_times)}): {wb_times[:5]}...")
            print(f"  EB ({len(eb_times)}): {eb_times[:5]}...")


def main():
    pdf_path = Path(__file__).parent.parent / "app" / "schedules" / "source_pdfs" / "standard" / "PATCO_Timetable.pdf"
    
    if not pdf_path.exists():
        print(f"Error: {pdf_path} not found")
        return
    
    print("="*60)
    print("PATCO PDF Column Analysis")
    print("="*60)
    
    analyze_column_positions(str(pdf_path))
    extract_with_column_boundaries(str(pdf_path))


if __name__ == "__main__":
    main()

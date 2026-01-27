#!/usr/bin/env python3
"""
Download PATCO timetables from the official website.
Features:
- Caches downloads (skips if PDF already exists)
- Cleans up files older than 7 days
"""

import re
import requests
from pathlib import Path
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from urllib.parse import urljoin


SCHEDULES_URL = "https://www.ridepatco.org/schedules/schedules.asp"
OUTPUT_DIR = Path(__file__).parent / "pdfs"
MAX_AGE_DAYS = 7


def cleanup_old_files(directory: Path, max_age_days: int = MAX_AGE_DAYS) -> int:
    """
    Delete files older than max_age_days.
    Returns count of deleted files.
    """
    if not directory.exists():
        return 0
    
    deleted = 0
    cutoff = datetime.now() - timedelta(days=max_age_days)
    
    for f in directory.glob("*.pdf"):
        if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            print(f"  Deleting old file: {f.name}")
            f.unlink()
            deleted += 1
    
    return deleted


def fetch_pdf_links(url: str) -> list[dict]:
    """
    Fetch the schedules page and extract all PDF links.
    """
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.text, 'html.parser')
    pdfs = []
    
    for link in soup.find_all('a', href=True):
        href = link['href']
        if '.pdf' in href.lower():
            full_url = urljoin(url, href)
            link_text = link.get_text(strip=True)
            
            if 'timetable' in href.lower() or 'timetable' in link_text.lower():
                pdf_type = 'standard'
            else:
                pdf_type = 'special'
            
            filename = href.split('/')[-1]
            
            if not any(p['url'] == full_url for p in pdfs):
                pdfs.append({
                    'url': full_url,
                    'filename': filename,
                    'name': link_text or filename,
                    'type': pdf_type,
                })
    
    return pdfs


def download_pdf(url: str, output_path: Path, skip_existing: bool = True) -> bool:
    """
    Download a PDF file. Skips if already exists and skip_existing=True.
    Returns True if downloaded (or already exists), False on error.
    """
    if skip_existing and output_path.exists():
        print(f"  Already exists: {output_path.name}")
        return True
    
    try:
        print(f"  Downloading: {url}")
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        
        output_path.write_bytes(response.content)
        print(f"  Saved: {output_path.name}")
        return True
        
    except Exception as e:
        print(f"  Error: {e}")
        return False


def download_all(skip_existing: bool = True, cleanup: bool = True) -> list[Path]:
    """
    Download all timetables from PATCO website.
    Returns list of downloaded PDF paths.
    """
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    # Cleanup old files
    if cleanup:
        deleted = cleanup_old_files(OUTPUT_DIR)
        if deleted:
            print(f"Cleaned up {deleted} old file(s)\n")
    
    # Fetch PDF links
    print(f"Fetching: {SCHEDULES_URL}")
    pdfs = fetch_pdf_links(SCHEDULES_URL)
    
    if not pdfs:
        print("No PDFs found!")
        return []
    
    print(f"Found {len(pdfs)} PDF(s)\n")
    
    # Download each
    downloaded = []
    for pdf in pdfs:
        output_path = OUTPUT_DIR / pdf['filename']
        if download_pdf(pdf['url'], output_path, skip_existing):
            downloaded.append(output_path)
    
    return downloaded


def main():
    print("="*60)
    print("PATCO Timetable Downloader")
    print("="*60 + "\n")
    
    downloaded = download_all()
    
    print(f"\n{'='*60}")
    print(f"Ready: {len(downloaded)} PDF(s) in {OUTPUT_DIR}")
    for p in downloaded:
        print(f"  • {p.name}")


if __name__ == "__main__":
    main()

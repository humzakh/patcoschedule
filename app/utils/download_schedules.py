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
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "schedules" / "source_pdfs"
PDF_DIR_STANDARD = OUTPUT_DIR / "standard"
PDF_DIR_SPECIAL = OUTPUT_DIR / "special"
MAX_AGE_DAYS = 7


def cleanup_special_files(directory: Path, max_age_days: int = MAX_AGE_DAYS) -> int:
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
    
    # Find standard timetable
    # Look for H2 containing "Timetable"
    # Structure is <td><H2>Timetable</H2><table>...<a href="...pdf">...</table></td>
    for h2 in soup.find_all(['h2', 'H2']):
        text = h2.get_text(strip=True)
        if 'Timetable' in text:
            # Found the standard timetable section using header
            # Look for the link in the same container (td)
            container = h2.find_parent('td')
            if container:
                for link in container.find_all('a', href=True):
                    href = link['href']
                    if '.pdf' in href.lower():
                        full_url = urljoin(url, href)
                        filename = href.split('/')[-1]
                        pdfs.append({
                            'url': full_url,
                            'filename': filename,
                            'name': link.get_text(strip=True) or filename,
                            'type': 'standard'
                        })
                        
        elif 'Special Schedule' in text:
            # Found special schedules section
            container = h2.find_parent('td')
            if container:
                for link in container.find_all('a', href=True):
                    href = link['href']
                    if '.pdf' in href.lower():
                        full_url = urljoin(url, href)
                        filename = href.split('/')[-1]
                        
                        # Avoid duplicates if logic overlaps (though here it shouldn't)
                        if not any(p['url'] == full_url for p in pdfs):
                            pdfs.append({
                                'url': full_url,
                                'filename': filename,
                                'name': link.get_text(strip=True) or filename,
                                'type': 'special'
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
        new_content = response.content
        
        # Check if identical to existing file to avoid touching mtime (which triggers Flask reload)
        if output_path.exists():
            current_content = output_path.read_bytes()
            if current_content == new_content:
                print(f"  File unchanged: {output_path.name}")
                return True
        
        output_path.write_bytes(new_content)
        print(f"  Saved: {output_path.name}")
        return True
        
    except Exception as e:
        print(f"  Error: {e}")
        return False


def download_all(skip_existing: bool = True, cleanup: bool = True) -> list[Path]:
    """
    Download all timetables from PATCO website.
    Download all timetables from PATCO website.
    Returns list of dicts with keys: url, filename, name, type, local_path
    """
    OUTPUT_DIR.mkdir(exist_ok=True)
    PDF_DIR_STANDARD.mkdir(exist_ok=True)
    PDF_DIR_SPECIAL.mkdir(exist_ok=True)
    
    # Cleanup old special files
    if cleanup:
        deleted = cleanup_special_files(PDF_DIR_SPECIAL)
        if deleted:
            print(f"Cleaned up {deleted} old special file(s)\n")
    
    # Fetch PDF links
    print(f"Fetching: {SCHEDULES_URL}")
    pdfs = fetch_pdf_links(SCHEDULES_URL)
    
    if not pdfs:
        print("No PDFs found!")
        return []
    
    print(f"Found {len(pdfs)} PDF(s)\n")
    
    # Download each
    downloaded = []
    
    # Track standard filenames to cleanup old ones
    current_standard_files = set()
    
    for pdf in pdfs:
        if pdf['type'] == 'standard':
            target_dir = PDF_DIR_STANDARD
            current_standard_files.add(pdf['filename'])
        else:
            target_dir = PDF_DIR_SPECIAL
            
        output_path = target_dir / pdf['filename']
        
        if download_pdf(pdf['url'], output_path, skip_existing):
            pdf['local_path'] = output_path
            downloaded.append(pdf)
            
    # Cleanup old standard files (keep only current ones)
    if cleanup and current_standard_files:
        for f in PDF_DIR_STANDARD.glob("*.pdf"):
            if f.name not in current_standard_files:
                print(f"  Removing obsolete standard schedule: {f.name}")
                f.unlink()
    
    return downloaded


def main():
    print("="*60)
    print("PATCO Timetable Downloader")
    print("="*60 + "\n")
    
    downloaded = download_all()
    
    print(f"\n{'='*60}")
    print(f"\n{'='*60}")
    print(f"Ready: {len(downloaded)} PDF(s)")
    for p in downloaded:
        print(f"  • {p['filename']} ({p['type']})")
        print(f"    URL: {p['url']}")


if __name__ == "__main__":
    main()

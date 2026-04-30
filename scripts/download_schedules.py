#!/usr/bin/env python3
"""
Download PATCO timetables from the official website.
Features:
- Caches downloads (skips if PDF already exists)
- Exports metadata for generate_data.py
"""

import json
import random
import sys
import time
from bs4 import BeautifulSoup
from pathlib import Path
from datetime import datetime, timedelta  
from urllib.error import HTTPError, URLError  
from urllib.parse import urljoin
from urllib.request import Request, urlopen

SCHEDULES_URL = "https://www.ridepatco.org/schedules/schedules.asp"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "schedules" / "source_pdfs"
METADATA_PATH = OUTPUT_DIR.parent / "metadata.json"
PDF_DIR_STANDARD = OUTPUT_DIR / "standard"
PDF_DIR_SPECIAL = OUTPUT_DIR / "special"
MAX_AGE_DAYS = 7

# Browser-like headers to avoid 403 Forbidden errors
DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.ridepatco.org/',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
}


def make_request(url: str, retries: int = 5, backoff_factor: float = 5.0, timeout: int = 30) -> bytes:
    """
    Perform a GET request using urllib.request with a custom retry loop.
    Returns response content as bytes.
    """
    last_error = None
    
    for attempt in range(retries):
        try:
            req = Request(url, headers=DEFAULT_HEADERS)
            with urlopen(req, timeout=timeout) as response:
                return response.read()
                
        except HTTPError as e:
            last_error = e
            # Retry on transient server errors or rate limiting (429, 500, 502, 503, 504)
            # PATCO sometimes gives 403 if it suspects a bot, we'll retry that too with backoff
            if e.code in [403, 429, 500, 502, 503, 504]:
                wait_time = backoff_factor * (2 ** attempt) + random.uniform(0, 1)
                print(f"  HTTP {e.code} error. Retrying in {wait_time:.1f}s... (attempt {attempt+1}/{retries})")
                time.sleep(wait_time)
                continue
            raise  # Fatal HTTP error
            
        except (URLError, TimeoutError) as e:
            last_error = e
            wait_time = backoff_factor * (2 ** attempt) + random.uniform(0, 1)
            print(f"  Connection error: {e}. Retrying in {wait_time:.1f}s... (attempt {attempt+1}/{retries})")
            time.sleep(wait_time)
            continue
            
    raise last_error if last_error else Exception(f"Failed to fetch {url} after {retries} attempts")


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
    content = make_request(url, timeout=30)
    soup = BeautifulSoup(content, 'html.parser')
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
        new_content = make_request(url, timeout=60)
        
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
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PDF_DIR_STANDARD.mkdir(parents=True, exist_ok=True)
    PDF_DIR_SPECIAL.mkdir(parents=True, exist_ok=True)
    
    # Cleanup old special files
    if cleanup:
        deleted = cleanup_special_files(PDF_DIR_SPECIAL)
        if deleted:
            print(f"Cleaned up {deleted} old special file(s)\n")
    
    # Fetch PDF links (retry logic is now inside make_request)
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
    
    try:
        downloaded = download_all()
    except Exception as e:
        print(f"\n❌ FATAL: Failed to fetch schedule data: {e}")
        sys.exit(1)
    
    if not downloaded:
        print("\n❌ FATAL: No PDFs were downloaded.")
        sys.exit(1)
    
    # Validate: at least one standard schedule must exist
    has_standard = any(p.get('type') == 'standard' for p in downloaded)
    if not has_standard:
        print("\n❌ FATAL: No standard schedule PDF was downloaded.")
        sys.exit(1)
    
    # Save metadata for generate_data.py
    # Convert Path objects to strings for JSON serialization
    metadata = []
    for p in downloaded:
        meta = p.copy()
        if 'local_path' in meta:
            meta['local_path'] = str(meta['local_path'])
        metadata.append(meta)
        
    with open(METADATA_PATH, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved metadata to: {METADATA_PATH}")
    
    print(f"\n{'='*60}")
    print(f"Ready: {len(downloaded)} PDF(s)")
    for p in downloaded:
        print(f"  • {p['filename']} ({p['type']})")
        print(f"    URL: {p['url']}")


if __name__ == "__main__":
    sys.exit(main())

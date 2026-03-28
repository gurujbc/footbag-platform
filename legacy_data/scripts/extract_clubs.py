#!/usr/bin/env python3
"""Extract club data from legacy mirror into legacy_data/seed/clubs.csv.

Walks all clubs/show/*/index.html pages under the mirror, parses club fields,
and writes a CSV. Idempotent: skips if the output CSV already exists and is
newer than this script.

Output columns:
  legacy_club_key, name, city, region, country, contact_email, external_url, description
"""

import csv
import os
import sys
from pathlib import Path
from bs4 import BeautifulSoup

MIRROR_ROOT = Path(__file__).parent.parent / "mirror_footbag_org" / "www.footbag.org"
CLUBS_SHOW_DIR = MIRROR_ROOT / "clubs" / "show"
OUTPUT_DIR = Path(__file__).parent.parent / "seed"
OUTPUT_CSV = OUTPUT_DIR / "clubs.csv"

FIELDNAMES = [
    "legacy_club_key",
    "name",
    "city",
    "region",
    "country",
    "contact_email",
    "external_url",
    "description",
]


def extract_email(tag):
    """Reconstruct obfuscated email from a <tt> element with interleaved <i> tags."""
    if tag is None:
        return ""
    # Remove all <i> children and concatenate remaining text
    for i_tag in tag.find_all("i"):
        i_tag.decompose()
    return tag.get_text(strip=True)


def parse_location(text):
    """Parse 'city, country' or 'city, region, country' into (city, region, country)."""
    parts = [p.strip() for p in text.split(",")]
    if len(parts) >= 3:
        city = parts[0]
        region = ", ".join(parts[1:-1])
        country = parts[-1]
    elif len(parts) == 2:
        city, country = parts
        region = ""
    else:
        city = text.strip()
        region = ""
        country = ""
    return city, region, country


def extract_club(html_path, legacy_club_key):
    with open(html_path, encoding="utf-8", errors="replace") as f:
        soup = BeautifulSoup(f, "html.parser")

    name_tag = soup.select_one("h1.clubsShowName")
    if not name_tag:
        return None
    name = name_tag.get_text(strip=True)
    if not name:
        return None

    location_tag = soup.select_one("div.clubsLocationHeader")
    location_text = location_tag.get_text(strip=True) if location_tag else ""
    city, region, country = parse_location(location_text) if location_text else ("", "", "")

    if not country:
        return None

    # Known legacy data corrections
    if country == "Basque Country":
        country = "Spain"

    # Email: find <tt> inside .clubsContacts
    contact_email = ""
    contacts_div = soup.select_one("div.clubsContacts")
    if contacts_div:
        tt = contacts_div.find("tt")
        if tt:
            contact_email = extract_email(tt)

    # External URL
    external_url = ""
    url_link = soup.select_one("div.clubsURL a[href]")
    if url_link:
        href = url_link.get("href", "").strip()
        # Skip relative/internal links
        if href.startswith("http://") or href.startswith("https://"):
            external_url = href

    # Description
    description = ""
    welcome_div = soup.select_one("div#ClubsWelcome")
    if welcome_div:
        description = welcome_div.get_text(separator=" ", strip=True)

    return {
        "legacy_club_key": legacy_club_key,
        "name": name,
        "city": city,
        "region": region,
        "country": country,
        "contact_email": contact_email,
        "external_url": external_url,
        "description": description,
    }


def main():
    if not CLUBS_SHOW_DIR.is_dir():
        print(f"ERROR: mirror not found at {CLUBS_SHOW_DIR}", file=sys.stderr)
        sys.exit(1)

    # Idempotent: skip if CSV is newer than this script
    script_mtime = Path(__file__).stat().st_mtime
    if OUTPUT_CSV.exists() and OUTPUT_CSV.stat().st_mtime > script_mtime:
        print(f"clubs.csv is up to date, skipping. ({OUTPUT_CSV})")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    rows = []
    skipped = 0

    for club_dir in sorted(CLUBS_SHOW_DIR.iterdir()):
        index = club_dir / "index.html"
        if not index.is_file():
            continue
        legacy_club_key = club_dir.name
        row = extract_club(index, legacy_club_key)
        if row is None:
            skipped += 1
        else:
            rows.append(row)

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} clubs to {OUTPUT_CSV} ({skipped} skipped).")


if __name__ == "__main__":
    main()

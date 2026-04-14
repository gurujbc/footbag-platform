# Trick Video Discovery

Structured research project to inventory video documentation for footbag tricks.

## Workflow

### Phase 1: Setup (this pass)
- Extract canonical trick list with aliases
- Define output schema
- Build search expansion file
- Seed from existing freestyle_records video URLs

### Phase 2: Research
- Search known sources for each trick + aliases
- Produce first-pass coverage CSV
- Generate review queue for uncertain matches

### Phase 3: Scale
- Expand to full dictionary
- De-duplicate sources
- Produce final coverage report

## Files

| File | Purpose |
|---|---|
| `trick_search_terms.csv` | Canonical names + all aliases for search |
| `known_sources.csv` | Registry of known video sources/channels |
| `video_coverage.csv` | Main output: one row per trick-video match |
| `review_queue.csv` | Uncertain matches needing human review |
| `seed_from_records.py` | Extracts existing video URLs from freestyle_records |
| `coverage_report.py` | Generates summary statistics |

## Output Schema (video_coverage.csv)

| Column | Description |
|---|---|
| canonical_trick_name | From freestyle_tricks.canonical_name |
| trick_slug | From freestyle_tricks.slug |
| matched_alias | The name/alias that matched in the source |
| video_exists | YES / NO / UNCERTAIN |
| confidence | HIGH / MEDIUM / LOW |
| source_type | youtube / vimeo / instagram / facebook / website / other |
| source_name | Channel or account name |
| page_or_channel | Channel/page URL |
| title | Video title |
| url | Direct video URL |
| timestamp | Timecode if trick appears at a specific point |
| creator | Person who made the video |
| clip_type | instructional / demonstration / competition / montage / passback |
| license_notes | Any known rights info (blank = unknown) |
| notes | Free text |
| reviewed | YES / NO |

## Confidence Levels

- **HIGH**: Trick is clearly named in title/description, or unmistakably demonstrated
- **MEDIUM**: Likely match based on context, but needs human review
- **LOW**: Weak evidence — do not treat as confirmed

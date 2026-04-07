import pandas as pd
import re
import unicodedata
import uuid

TARGET_EVENT = 955745735

# UUID5 namespace — matches PLAYERS_NAMESPACE in 02p5
PLAYERS_NAMESPACE = uuid.UUID("11111111-2222-3333-4444-555555555555")

# Fixed UUID for the unknown/missing partner slot — stable and recognisable
UNKNOWN_PARTNER_UUID = str(uuid.uuid5(PLAYERS_NAMESPACE, "[unknown partner]"))


def _norm(s: str) -> str:
    return " ".join(str(s).lower().split())


def _is_doubles_div(div: str) -> bool:
    """Return True if division name indicates a doubles format (handles 'Dbl' abbreviation)."""
    d = div.lower()
    return "doubles" in d or re.search(r'\bdbl\b', d) is not None


def _ascii_fold(s: str) -> str:
    """Lowercase + strip diacritics + collapse whitespace for fuzzy matching.
    Also strips superscript digits (e.g. ³) which appear as corrupt glyph
    replacements for Polish ł in some mirror encodings."""
    # Strip superscript digits that are encoding corruption artifacts
    s2 = re.sub(r"[\u00B2\u00B3\u00B9]", "", str(s))
    nfkd = unicodedata.normalize("NFKD", s2)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def _ascii_strip(s: str) -> str:
    """Strip ALL non-ASCII characters, lowercase, collapse whitespace.
    Handles Polish/Czech stroked letters (ł, ø, etc.) that don't decompose
    via NFKD — both sides of a comparison may have them stripped differently."""
    ascii_only = "".join(c for c in str(s).lower() if ord(c) < 128)
    return " ".join(ascii_only.split())


def _make_uuid(name: str) -> str:
    return str(uuid.uuid5(PLAYERS_NAMESPACE, _norm(name)))

SINGLES_TRANSFORMS = {
    "Jason Buster / Wichita KS": "Jason Buster",
    "Jonny Buster / Wichita KS": "Jonny Buster",
    "Junior Barron / Wichita KS": "Junior Barron",
    "Brian McKenzie / Hebron NE": "Brian McKenzie",
    "Aerial Santesteban / Austin TX": "Aerial Santesteban",
    "Romie Williams / McPherson KS": "Romie Williams",
    "David Edgmon / Wichita KS": "David Edgmon",
    "Garry Williams / McPherson KS": "Garry Williams",
    "Danny Kristek / Wichita KS": "Danny Kristek",
}

DOUBLES_REPAIRS = {
    "Aeriel Santestaban / Austin TX": "Aeriel Santestaban / [UNKNOWN PARTNER]",
    "Noah Wilson / Wichita KS": "Noah Wilson / [UNKNOWN PARTNER]",
    "Romie Williams / Wichita KS": "Romie Williams / [UNKNOWN PARTNER]",
}

# Exact-match deterministic repairs outside Kansas
EXACT_TEAM_DISPLAY_REPAIRS = {
    "Brett Milliken / ?Crazy? Mike Craig": "Brett Milliken / Mike Craig",
}

EXACT_PLAYER_CONVERSIONS = {
    # event_id, exact bad team_display_name -> corrected player name
    (1222687523, "Jan Dexter Struz ? Blurry Torque / Whirly Gig"): "Jan Dexter Struz",
}


def is_country_code_format(second_half):
    return bool(re.fullmatch(r"[A-Z][a-z]+ [A-Z]{2}", second_half))


def normalize_blank(x):
    if pd.isna(x):
        return ""
    return str(x).strip()


def strip_nickname_artifacts(text: str) -> str:
    """
    Remove nickname wrappers like ?Crazy? from a display string.
    Conservative: only removes balanced ?...?
    """
    text = normalize_blank(text)
    text = re.sub(r"\?[^?]+\?", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace(" / ", " / ")
    return text


KNOWN_LOCATION_PREFIXES = {
    "Chicago", "Urbana", "Charleston", "Milan", "Selma",
    "Vancouver", "Malta", "Sherman", "Winfield", "Pittsburgh",
}

PERSON_CANON_EXACT_FIXES = {
    "david Butcher": "David Butcher",
    "Alexis Dechenes": "Alexis Deschenes",
    "Alexis Deschene": "Alexis Deschenes",
}

DIVISION_EXACT_FIXES = {
    "Intrmediate Singles Net": "Intermediate Singles Net",
    "Intermediat Dbl Net": "Intermediate Doubles Net",
    "Womens Singles": "Women's Singles",
    "Womens Doubles": "Women's Doubles",
    "Womens Consecutive": "Women's Consecutive",
    "Womens Freestyle": "Women's Freestyle",
    "Womens Doubles Net": "Women's Doubles Net",
    "Womens Singles Net": "Women's Singles Net",
    "Womens Open Singles Net": "Women's Open Singles Net",
    "Womens Open Singles": "Women's Open Singles",
    "Womens Intermediate Singles Net": "Women's Intermediate Singles Net",
    "Womens Singles Freestyle": "Women's Singles Freestyle",
    "Womens Footbag Golf": "Women's Footbag Golf",
    "Womens Distance One Pass": "Women's Distance One Pass",
    "Womens Speed Consecutives": "Women's Speed Consecutives",
    "Net Singles Womens": "Women's Singles Net",
    "Net Open Womens Singles": "Women's Open Singles Net",
    "Freestyle Open Womens Singles": "Women's Open Singles Freestyle",
    "Consecutive Open Womens Singles": "Women's Open Singles Consecutives",
}

# Handle replacement-char corruption seen in division strings.
DIVISION_EXACT_FIXES.update({
    "Mixed Dou�Bles Rou�Tines": "Mixed Doubles Routines",
    "Open Cir�Cle Con�Test": "Open Circle Contest",
    "Open Dou�Bles Rou�Tines": "Open Doubles Routines",
    "Open Freestyle Rou�Tines": "Open Freestyle Routines",
    "Women's Cir�Cle Con�Test": "Women's Circle Contest",
    "Women's Freestyle Rou�Tines": "Women's Freestyle Routines",
})


def _clean_noise_tokens(name: str):
    if not isinstance(name, str):
        return name, False
    s = name.strip()
    new = re.sub(r"^\s*nd=\s*", "", s, flags=re.I)
    new = re.sub(r"\s+", " ", new).strip()
    return new, (new != s)


def _strip_location_prefix(name: str):
    """
    Chicago Pete Nawara -> Pete Nawara
    Urbana Jeff Cruz -> Jeff Cruz
    Sherman Josh Vorvel -> Josh Vorvel
    """
    if not isinstance(name, str):
        return name, False
    s = name.strip()
    parts = s.split()
    if len(parts) >= 3 and parts[0] in KNOWN_LOCATION_PREFIXES:
        return " ".join(parts[1:]), True
    return s, False


def _controlled_capitalize_name(name: str):
    """
    Conservative capitalization:
    only capitalizes fully-lowercase tokens.
    Leaves mixed-case names alone.
    """
    if not isinstance(name, str):
        return name, False

    def fix_token(tok: str) -> str:
        if tok.islower():
            return tok.capitalize()
        return tok

    new = " ".join(fix_token(t) for t in name.split())
    return new, (new != name)


def _normalize_person_canon(name: str, audit: dict):
    if not isinstance(name, str):
        return name

    s = name

    s, changed = _clean_noise_tokens(s)
    if changed:
        audit["noise_tokens_removed"] += 1

    s, changed = _strip_known_suffix_artifacts(s)
    if changed:
        audit["known_suffix_artifacts_removed"] += 1

    s, changed = _strip_location_prefix(s)
    if changed:
        audit["location_prefix_stripped"] += 1

    s2 = PERSON_CANON_EXACT_FIXES.get(s, s)
    if s2 != s:
        audit["person_canon_normalized"] += 1
    s = s2

    s, changed = _controlled_capitalize_name(s)
    if changed:
        audit["person_canon_normalized"] += 1

    return s.strip()


def _strip_known_suffix_artifacts(name: str):
    if not isinstance(name, str):
        return name, False
    s = name.strip()
    new = re.sub(r"-prizes\b", "", s, flags=re.I)
    new = re.sub(r"\s+", " ", new).strip()
    return new, (new != s)


def _repair_unicode_division_noise(name: str):
    if not isinstance(name, str):
        return name

    s = name

    # Known embedded replacement-char patterns
    s = s.replace("Dou�Bles", "Doubles")
    s = s.replace("Rou�Tines", "Routines")
    s = s.replace("Cir�Cle", "Circle")
    s = s.replace("Con�Test", "Contest")

    # remove any stray replacement chars left behind
    s = s.replace("�", "")

    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_division_name(name: str, audit: dict):
    if not isinstance(name, str):
        return name
    s = name.strip()
    original = s
    s = DIVISION_EXACT_FIXES.get(s, s)
    s = _repair_unicode_division_noise(s)

    # light generic cleanup after exact fixes
    s = re.sub(r"\bIntrmediate\b", "Intermediate", s)
    s = re.sub(r"\bIntermediat\b", "Intermediate", s)
    s = re.sub(r"\bWomens\b", "Women's", s)
    s = re.sub(r"\bDbl\b", "Doubles", s)
    s = re.sub(r"\s+", " ", s).strip()

    if s != original:
        audit["division_normalized"] += 1
    if "�" in original and s != original:
        audit["unicode_division_repairs"] += 1
    return s


def patch_file(path: str):
    df = pd.read_csv(path)

    audit = {
        "person_canon_normalized": 0,
        "division_normalized": 0,
        "unicode_division_repairs": 0,
        "known_suffix_artifacts_removed": 0,
        "location_prefix_stripped": 0,
        "noise_tokens_removed": 0,
        "doubles_singleton_team_fixed": 0,
        "doubles_player_unknown_partner": 0,
        "metadata_rows_removed": 0,
        "team_rows_superseded_by_player": 0,
        "exact_duplicate_player_rows_removed": 0,
        "pool_shadow_rows_removed": 0,
    }

    if "event_id" not in df.columns or "team_display_name" not in df.columns:
        print(f"Skipping {path}: required columns missing")
        return

    # Patch (02.6)
    # Remove confirmed duplicate record (1982 Worlds Portland duplicate)
    BAD_EVENT_IDS = {
        "9921901",
    }
    df = df[~df["event_id"].astype(str).isin(BAD_EVENT_IDS)].copy()

    # ----------------------------------------------------------------
    # Pre-pass 0: Remove metadata/admin non-player rows.
    # Some events have rows whose person_canon or team_display_name is a
    # metadata label (e.g. "MINUTE TIMED", "EX-AEQUO", "HIGHEST LEVEL")
    # that was parsed as a placement entry.  Drop them unconditionally.
    # ----------------------------------------------------------------
    METADATA_NON_PLAYER_PHRASES = {
        "MINUTE TIMED", "MIN TIMED", "MIN. TIMED",
        "TIMED KICKING", "TIMED FOOTBAG",
        "EX-AEQUO", "EX AEQUO", "EXAEQUO",
        "HIGHEST LEVEL",
    }

    def _is_metadata_row(r):
        pc  = normalize_blank(r.get("person_canon",      "")).upper()
        tdn = normalize_blank(r.get("team_display_name", "")).upper()
        for phrase in METADATA_NON_PLAYER_PHRASES:
            if phrase in pc or phrase in tdn:
                return True
        return False

    mask_metadata = df.apply(_is_metadata_row, axis=1)
    n_metadata = int(mask_metadata.sum())
    df = df[~mask_metadata].reset_index(drop=True)
    audit["metadata_rows_removed"] = n_metadata

    # ----------------------------------------------------------------
    # Pre-pass 1: Fix Problem A — old-format team singletons.
    # These rows have competitor_type="team", a real person_id, and
    # an empty team_person_key but a valid "Name1 / Name2" team_display_name.
    # The v77 patch left these 6 rows unconverted.  Fix: extract the
    # partner name, generate a UUID5 for them, and build a proper piped
    # team_person_key so the workbook uses team_display_name, not person.
    # ----------------------------------------------------------------
    if "team_person_key" in df.columns and "team_display_name" in df.columns:
        mask_a = (
            (df["competitor_type"] == "team")
            & (df["team_person_key"].fillna("").str.strip() == "")
            & (df["team_display_name"].fillna("").str.contains(" / ", regex=False))
            & (df["person_canon"].fillna("") != "")
            & (df["person_canon"].fillna("") != "__NON_PERSON__")
            & (df["division_canon"].fillna("").apply(_is_doubles_div))
        )
        for idx in df[mask_a].index:
            row = df.loc[idx]
            person_id = normalize_blank(row.get("person_id", ""))
            tdn = normalize_blank(row.get("team_display_name", ""))
            person_canon = normalize_blank(row.get("person_canon", ""))
            # Extract partner name: whichever side of " / " is NOT person_canon
            parts = [p.strip() for p in tdn.split(" / ", 1)]
            partner_name = parts[1] if parts[0] == person_canon else parts[0]
            partner_uuid = _make_uuid(partner_name)
            new_tpk = f"{person_id}|{partner_uuid}" if person_id else partner_uuid
            df.at[idx, "team_person_key"] = new_tpk
            df.at[idx, "person_canon"] = "__NON_PERSON__"
            df.at[idx, "person_id"] = ""
            audit["doubles_singleton_team_fixed"] += 1

    # ----------------------------------------------------------------
    # Pre-pass 2: Fix Problem B — competitor_type="player" rows in
    # doubles divisions that have a real person_canon but no partner.
    # These produce naked single-name display strings in doubles results.
    # Enforcement: convert to a team row showing "Name / [UNKNOWN PARTNER]".
    #
    # Exclusions (legitimate individual standings within doubles formats):
    #   - division contains "Golf"        (Doubles Golf — individual scores)
    #   - division contains "Americano"   (rotating-partner format)
    #   - division contains "Singles"     (merged "Singles Net / Doubles Net" name)
    #   - person_canon contains " / " or "?" or "+" (already an unsplit pair)
    #   - person_canon is __NON_PERSON__ or empty
    # ----------------------------------------------------------------
    if "team_person_key" in df.columns and "team_display_name" in df.columns:
        # Build set of (event_id, division_canon, place) that already have a
        # real piped/formatted team row — player rows at those slots don't
        # need a ghost partner.  Catches both:
        #   (a) v77+ piped rows: team_person_key contains "|"
        #   (b) old-format team rows: competitor_type="team" + " / " in
        #       team_display_name but team_person_key is a bare single UUID
        _team_slots: set = set()
        for _, _r in df.iterrows():
            tpk = normalize_blank(_r.get("team_person_key", ""))
            tdn = normalize_blank(_r.get("team_display_name", ""))
            is_team_row = (
                _r.get("competitor_type", "") == "team"
                and ("|" in tpk or " / " in tdn)
            )
            if is_team_row:
                _team_slots.add((
                    normalize_blank(_r.get("event_id", "")),
                    normalize_blank(_r.get("division_canon", "")),
                    normalize_blank(str(_r.get("place", ""))),
                ))

        def _is_doubles_player_row(r):
            div = normalize_blank(r.get("division_canon", ""))
            if not _is_doubles_div(div):
                return False
            if any(kw in div for kw in ("golf", "americano", "singles")):
                return False
            if r.get("competitor_type", "") != "player":
                return False
            pc = normalize_blank(r.get("person_canon", ""))
            if not pc or pc == "__NON_PERSON__":
                return False
            if any(sep in pc for sep in (" / ", " ? ", " + ")):
                return False
            # Skip if a piped team row already covers this placement
            slot = (
                normalize_blank(r.get("event_id", "")),
                normalize_blank(r.get("division_canon", "")),
                normalize_blank(str(r.get("place", ""))),
            )
            if slot in _team_slots:
                return False
            return True

        # Rows covered by a piped team row: drop them (the team row is authoritative).
        def _is_superseded_doubles_player(r):
            if r.get("competitor_type", "") != "player":
                return False
            div = normalize_blank(r.get("division_canon", ""))
            if not _is_doubles_div(div):
                return False
            if any(kw in div for kw in ("golf", "americano", "singles")):
                return False
            slot = (
                normalize_blank(r.get("event_id", "")),
                normalize_blank(r.get("division_canon", "")),
                normalize_blank(str(r.get("place", ""))),
            )
            return slot in _team_slots

        mask_superseded = df.apply(_is_superseded_doubles_player, axis=1)
        n_superseded = mask_superseded.sum()
        df = df[~mask_superseded].reset_index(drop=True)
        if n_superseded:
            audit["doubles_player_superseded_by_team"] = int(n_superseded)

        mask_b = df.apply(_is_doubles_player_row, axis=1)
        for idx in df[mask_b].index:
            row = df.loc[idx]
            pc = normalize_blank(row.get("person_canon", ""))
            person_id = normalize_blank(row.get("person_id", ""))
            new_tpk = f"{person_id}|{UNKNOWN_PARTNER_UUID}" if person_id else UNKNOWN_PARTNER_UUID
            df.at[idx, "team_display_name"] = f"{pc} / [UNKNOWN PARTNER]"
            df.at[idx, "team_person_key"] = new_tpk
            df.at[idx, "person_canon"] = "__NON_PERSON__"
            df.at[idx, "competitor_type"] = "team"
            df.at[idx, "person_id"] = ""
            audit["doubles_player_unknown_partner"] += 1

    # ----------------------------------------------------------------
    # Pre-pass 3: Remove team rows in NON-doubles disciplines that are
    # superseded by a player row at the same (event, division, place).
    # Pattern: a "Name / City" or similar artifact team row co-exists
    # with a clean ct=player row for the same leading player.
    # Only targets team rows whose first component matches a player row.
    # ----------------------------------------------------------------
    if "team_display_name" in df.columns and "person_canon" in df.columns:
        # Collect (event_id, division_canon, place, person_canon.lower()) for player rows
        # in non-doubles divisions.
        _player_slots: dict = {}
        for _, _r in df.iterrows():
            if _r.get("competitor_type", "") != "player":
                continue
            div = normalize_blank(_r.get("division_canon", ""))
            if _is_doubles_div(div):
                continue
            pc = normalize_blank(_r.get("person_canon", ""))
            if not pc or pc == "__NON_PERSON__":
                continue
            slot = (
                normalize_blank(_r.get("event_id", "")),
                normalize_blank(_r.get("division_canon", "")),
                normalize_blank(str(_r.get("place", ""))),
            )
            # Store exact-lower, ascii-folded, and ascii-stripped forms for
            # robust matching across encoding variants (diacritics, ł, etc.)
            _player_slots.setdefault(slot, set()).add(pc.lower())
            _player_slots[slot].add(_ascii_fold(pc))
            _player_slots[slot].add(_ascii_strip(pc))

        def _is_team_superseded_by_player(r):
            if r.get("competitor_type", "") != "team":
                return False
            div = normalize_blank(r.get("division_canon", ""))
            if _is_doubles_div(div):
                return False
            tdn = normalize_blank(r.get("team_display_name", ""))
            if " / " not in tdn:
                return False
            parts = tdn.split(" / ", 1)
            first_part = parts[0].strip()
            second_part = parts[1].strip() if len(parts) > 1 else ""
            slot = (
                normalize_blank(r.get("event_id", "")),
                normalize_blank(r.get("division_canon", "")),
                normalize_blank(str(r.get("place", ""))),
            )
            known = _player_slots.get(slot, set())
            # Remove if EITHER the first OR second component matches a standalone
            # player row at the same slot (artifact team row in a singles div).
            for part in (first_part, second_part):
                if not part:
                    continue
                if (part.lower() in known
                        or _ascii_fold(part) in known
                        or _ascii_strip(part) in known):
                    return True
            return False

        mask_team_sup = df.apply(_is_team_superseded_by_player, axis=1)
        n_team_sup = int(mask_team_sup.sum())
        df = df[~mask_team_sup].reset_index(drop=True)
        audit["team_rows_superseded_by_player"] = n_team_sup

    # ----------------------------------------------------------------
    # Pre-pass 4: Deduplicate exact duplicate player rows.
    # Same (event_id, division_canon, place, person_canon) appearing
    # twice as competitor_type="player" — keep the first occurrence.
    # ----------------------------------------------------------------
    if "competitor_type" in df.columns and "person_canon" in df.columns:
        player_mask   = df["competitor_type"] == "player"
        non_empty_pc  = df["person_canon"].fillna("").str.strip() != ""
        is_dup        = df.duplicated(
            subset=["event_id", "division_canon", "place", "person_canon"],
            keep="first",
        )
        mask_exact_dup = player_mask & non_empty_pc & is_dup
        n_exact_dup = int(mask_exact_dup.sum())
        df = df[~mask_exact_dup].reset_index(drop=True)
        audit["exact_duplicate_player_rows_removed"] = n_exact_dup

    # ----------------------------------------------------------------
    # Pre-pass 5: Remove pool-shadow duplicate player rows.
    #
    # Pool-format events produce multiple rows for the same player in
    # the same division: one from the pool stage (place shared with
    # several others — e.g., all group-A players share place=1) and
    # one from the final standings (unique place among all competitors).
    #
    # Detection rule: within (event_id, division_canon, competitor_type=player),
    # for each person_canon appearing at 2+ distinct places:
    #   - Count how many distinct players sit at each of those places.
    #     A place is "unique" if the player is the only one there (count=1).
    #     A place is "shared" if 2+ players share it (count>1 = pool group).
    #   - If at least one place is unique AND at least one is shared:
    #     → drop the shared-place rows for that player (keep unique-place rows).
    #   - If all places are shared or all are unique: leave as-is (ambiguous).
    # ----------------------------------------------------------------
    if "competitor_type" in df.columns and "person_canon" in df.columns:
        # Iterate until no more shadow rows can be removed.  Removing one
        # person's shared-place row can promote another person from "all
        # shared" to "has a unique place" — so multiple passes are needed.
        total_shadow_removed = 0
        while True:
            player_rows = df[
                (df["competitor_type"] == "player")
                & (df["person_canon"].fillna("").str.strip() != "")
                & (df["person_canon"].fillna("") != "__NON_PERSON__")
            ].copy()

            # Count how many distinct players share each (event, div, place).
            place_pop = (
                player_rows
                .groupby(["event_id", "division_canon", "place"])["person_canon"]
                .transform("nunique")
            )
            player_rows = player_rows.assign(_place_pop=place_pop.values)

            # For each player in each (event, div), find places that are
            # unique vs shared, then flag the shared-place rows for removal
            # when the player also has at least one unique-place row.
            shadow_indices = []
            for (eid, div, pc), grp in player_rows.groupby(
                    ["event_id", "division_canon", "person_canon"]):
                if len(grp["place"].unique()) < 2:
                    continue   # only one distinct place — nothing to de-shadow
                unique_places = set(grp.loc[grp["_place_pop"] == 1, "place"])
                shared_places = set(grp.loc[grp["_place_pop"]  > 1, "place"])
                if unique_places and shared_places:
                    shadow_idx = grp[grp["place"].isin(shared_places)].index.tolist()
                    shadow_indices.extend(shadow_idx)

            if not shadow_indices:
                break   # stable — nothing more to remove
            df = df.drop(index=shadow_indices).reset_index(drop=True)
            total_shadow_removed += len(shadow_indices)

        if total_shadow_removed:
            audit["pool_shadow_rows_removed"] = total_shadow_removed

    changed = 0

    for idx, row in df.iterrows():
        event_id = row.get("event_id")
        disp = normalize_blank(row.get("team_display_name", ""))

        # ------------------------------------------------------------
        # A. Kansas exact deterministic fixes
        # ------------------------------------------------------------
        if event_id == TARGET_EVENT:
            # 9 singles/freestyle/golf rows -> convert team to player
            if disp in SINGLES_TRANSFORMS:
                df.at[idx, "competitor_type"] = "player"
                if "person_canon" in df.columns:
                    df.at[idx, "person_canon"] = SINGLES_TRANSFORMS[disp]
                if "team_display_name" in df.columns:
                    df.at[idx, "team_display_name"] = ""
                if "team_person_key" in df.columns:
                    df.at[idx, "team_person_key"] = ""
                changed += 1
                continue

            # 3 doubles rows -> preserve row, replace fake city partner
            if disp in DOUBLES_REPAIRS:
                if "team_display_name" in df.columns:
                    df.at[idx, "team_display_name"] = DOUBLES_REPAIRS[disp]
                if "team_person_key" in df.columns:
                    df.at[idx, "team_person_key"] = ""
                changed += 1
                continue

        # ------------------------------------------------------------
        # B. Exact-match team display cleanup (safe)
        # ------------------------------------------------------------
        if disp in EXACT_TEAM_DISPLAY_REPAIRS:
            df.at[idx, "team_display_name"] = EXACT_TEAM_DISPLAY_REPAIRS[disp]
            changed += 1
            continue

        # ------------------------------------------------------------
        # C. Exact-match malformed row -> convert to player (safe)
        # ------------------------------------------------------------
        key = (event_id, disp)
        if key in EXACT_PLAYER_CONVERSIONS:
            corrected_name = EXACT_PLAYER_CONVERSIONS[key]
            df.at[idx, "competitor_type"] = "player"
            if "person_canon" in df.columns:
                df.at[idx, "person_canon"] = corrected_name
            if "team_display_name" in df.columns:
                df.at[idx, "team_display_name"] = ""
            if "team_person_key" in df.columns:
                df.at[idx, "team_person_key"] = ""
            changed += 1
            continue

        # ------------------------------------------------------------
        # D. Convert "Name / City ST" artifact rows to player rows (safe)
        # ------------------------------------------------------------
        if " / " in disp:
            first, second = disp.split(" / ", 1)
            second = second.strip()

            if is_country_code_format(second):
                city = second.split()[0]
                df.at[idx, "competitor_type"] = "player"
                if "person_canon" in df.columns:
                    df.at[idx, "person_canon"] = f"{city} {first.strip()}"
                if "team_display_name" in df.columns:
                    df.at[idx, "team_display_name"] = ""
                if "team_person_key" in df.columns:
                    df.at[idx, "team_person_key"] = ""
                changed += 1
                continue

        # ------------------------------------------------------------
        # E. Optional conservative nickname cleanup (disabled by default)
        #    Leave this block commented until you want to generalize.
        # ------------------------------------------------------------
        # cleaned = strip_nickname_artifacts(disp)
        # if cleaned != disp and disp.count("?") >= 2:
        #     df.at[idx, "team_display_name"] = cleaned
        #     changed += 1

    # ------------------------------------------------------------
    # E. General semantic cleanup
    # ------------------------------------------------------------
    if "person_canon" in df.columns:
        df["person_canon"] = df["person_canon"].apply(
            lambda x: _normalize_person_canon(x, audit)
        )

    for div_col in ["division", "division_canon"]:
        if div_col in df.columns:
            df[div_col] = df[div_col].apply(
                lambda x: _normalize_division_name(x, audit)
            )

    df.to_csv(path, index=False)
    print(f"{path}: changed {changed} rows")
    print("  audit:")
    for k, v in audit.items():
        print(f"    {k}: {v}")


def main():
    patch_file("out/Placements_Flat.csv")
    patch_file("out/Placements_ByPerson.csv")


if __name__ == "__main__":
    main()

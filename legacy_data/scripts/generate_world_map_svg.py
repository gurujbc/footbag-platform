#!/usr/bin/env python3
"""Generate src/public/img/world-map.svg from Natural Earth 110m via world-atlas.

Pure stdlib — no geo libraries required. Fetches TopoJSON from jsDelivr,
decodes arcs (delta-encoded coordinates with quantization transform), applies
equirectangular projection, and writes an SVG where each country path has an
id attribute matching its ISO alpha-2 code (where known).

Run once; idempotent (overwrites output if present).
"""

import json
import math
import urllib.request
from pathlib import Path

TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
OUTPUT = Path(__file__).parent.parent.parent / "src" / "public" / "img" / "world-map.svg"

# ISO 3166-1 numeric → alpha-2  (only the codes present in the 110m dataset)
NUMERIC_TO_A2: dict[str, str] = {
    "004": "AF", "008": "AL", "012": "DZ", "024": "AO", "032": "AR",
    "036": "AU", "040": "AT", "050": "BD", "056": "BE", "068": "BO",
    "076": "BR", "100": "BG", "104": "MM", "116": "KH", "120": "CM",
    "124": "CA", "140": "CF", "144": "LK", "152": "CL", "156": "CN",
    "170": "CO", "178": "CG", "180": "CD", "188": "CR", "191": "HR",
    "192": "CU", "203": "CZ", "208": "DK", "214": "DO", "218": "EC",
    "818": "EG", "222": "SV", "231": "ET", "233": "EE", "246": "FI",
    "250": "FR", "266": "GA", "276": "DE", "288": "GH", "300": "GR",
    "320": "GT", "324": "GN", "332": "HT", "340": "HN", "348": "HU",
    "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE",
    "376": "IL", "380": "IT", "388": "JM", "392": "JP", "400": "JO",
    "398": "KZ", "404": "KE", "408": "KP", "410": "KR", "414": "KW",
    "418": "LA", "422": "LB", "430": "LR", "434": "LY", "440": "LT",
    "442": "LU", "458": "MY", "484": "MX", "504": "MA", "508": "MZ",
    "516": "NA", "524": "NP", "528": "NL", "554": "NZ", "558": "NI",
    "562": "NE", "566": "NG", "578": "NO", "586": "PK", "591": "PA",
    "598": "PG", "600": "PY", "604": "PE", "608": "PH", "616": "PL",
    "620": "PT", "630": "PR", "642": "RO", "643": "RU", "682": "SA",
    "686": "SN", "694": "SL", "706": "SO", "710": "ZA", "724": "ES",
    "703": "SK", "705": "SI", "729": "SD", "752": "SE", "756": "CH",
    "760": "SY", "762": "TJ", "764": "TH", "768": "TG", "780": "TT",
    "788": "TN", "792": "TR", "800": "UG", "804": "UA", "784": "AE",
    "826": "GB", "840": "US", "858": "UY", "860": "UZ", "862": "VE",
    "704": "VN", "887": "YE", "894": "ZM", "716": "ZW", "012": "DZ",
    "051": "AM", "031": "AZ", "112": "BY", "064": "BT", "070": "BA",
    "072": "BW", "096": "BN", "174": "KM", "417": "KG", "426": "LS",
    "450": "MG", "454": "MW", "466": "ML", "478": "MR", "496": "MN",
    "499": "ME", "064": "BT", "659": "KN", "090": "SB", "275": "PS",
    "748": "SZ", "756": "CH", "795": "TM", "626": "TL", "792": "TR",
}

SVG_W = 960
SVG_H = 500


def fetch_topojson(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def decode_arcs(topology: dict) -> list[list[tuple[float, float]]]:
    """Delta-decode topojson arcs and apply the quantization transform."""
    tx, ty = topology["transform"]["translate"]
    sx, sy = topology["transform"]["scale"]
    decoded = []
    for arc in topology["arcs"]:
        points = []
        x = y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            lon = x * sx + tx
            lat = y * sy + ty
            points.append((lon, lat))
        decoded.append(points)
    return decoded


def project(lon: float, lat: float) -> tuple[float, float]:
    """Equirectangular projection."""
    px = (lon + 180) / 360 * SVG_W
    py = (90 - lat) / 180 * SVG_H
    return px, py


def arc_to_path(arc_points: list[tuple[float, float]], reverse: bool) -> str:
    pts = list(reversed(arc_points)) if reverse else arc_points
    parts = []
    for i, (lon, lat) in enumerate(pts):
        x, y = project(lon, lat)
        cmd = "M" if i == 0 else "L"
        parts.append(f"{cmd}{x:.2f},{y:.2f}")
    return "".join(parts)


def geometry_to_path(geometry: dict, decoded_arcs: list) -> str:
    """Convert a topojson geometry to an SVG path d attribute."""
    def rings_to_d(rings: list[list[int]]) -> str:
        parts = []
        for ring in rings:
            ring_parts = []
            for arc_idx in ring:
                reverse = arc_idx < 0
                idx = ~arc_idx if reverse else arc_idx
                arc_pts = decoded_arcs[idx]
                # Skip first point on subsequent arcs (shared with prev end)
                pts = list(reversed(arc_pts)) if reverse else arc_pts
                if ring_parts:
                    pts = pts[1:]
                for j, (lon, lat) in enumerate(pts):
                    x, y = project(lon, lat)
                    cmd = "M" if (j == 0 and not ring_parts) else "L"
                    ring_parts.append(f"{cmd}{x:.2f},{y:.2f}")
            ring_parts.append("Z")
            parts.append("".join(ring_parts))
        return "".join(parts)

    gtype = geometry["type"]
    arcs = geometry.get("arcs", [])

    if gtype == "Polygon":
        return rings_to_d(arcs)
    elif gtype == "MultiPolygon":
        return "".join(rings_to_d(rings) for rings in arcs)
    return ""


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching {TOPOJSON_URL} ...")
    topo = fetch_topojson(TOPOJSON_URL)

    print("Decoding arcs ...")
    decoded = decode_arcs(topo)

    geometries = topo["objects"]["countries"]["geometries"]
    print(f"Building SVG for {len(geometries)} countries ...")

    paths = []
    for geom in geometries:
        numeric_id = str(geom.get("id", "")).zfill(3)
        a2 = NUMERIC_TO_A2.get(numeric_id, "")
        d = geometry_to_path(geom, decoded)
        if not d:
            continue
        id_attr = f'id="{a2}"' if a2 else f'id="n{numeric_id}"'
        paths.append(f'  <path {id_attr} d="{d}"/>')

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {SVG_W} {SVG_H}" '
        f'role="img" aria-label="World map">\n'
        + "\n".join(paths)
        + "\n</svg>\n"
    )

    OUTPUT.write_text(svg, encoding="utf-8")
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Written {OUTPUT} ({size_kb:.1f} KB, {len(paths)} paths)")


if __name__ == "__main__":
    main()

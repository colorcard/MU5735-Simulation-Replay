#!/usr/bin/env python3
"""Build a normalized CSV from MU5735 ADS-B Reveal workbook data."""

from __future__ import annotations

import csv
import re
import zipfile
import xml.etree.ElementTree as ET
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REVEAL_DIR = ROOT / "data" / "raw" / "adsb_reveal"
MERGED_XLSX = REVEAL_DIR / "Merged Data.xlsx"
FR24_CSV = REVEAL_DIR / "Flightradar24 Granular Data.csv"
OUT_CSV = ROOT / "data" / "processed" / "MU5735_ADSB_reveal_fused.csv"

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
COL_RE = re.compile(r"([A-Z]+)")
CST = timezone(timedelta(hours=8))
FR24_MATCH_MAX_DELTA_S = 1.0


@dataclass
class Fr24Row:
    local_dt: datetime
    raw: dict[str, str]


def col_to_index(ref: str) -> int:
    col = COL_RE.match(ref).group(1)
    idx = 0
    for ch in col:
        idx = idx * 26 + ord(ch) - 64
    return idx - 1


def parse_datetime(value: str) -> datetime:
    if value.endswith("+08:00") or value.endswith("+00:00") or value.endswith("Z"):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(CST)
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=CST)
        except ValueError:
            continue
    raise ValueError(f"Unsupported datetime format: {value}")


def parse_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_intish(value: str | None) -> int | None:
    num = parse_float(value)
    return None if num is None else int(round(num))


def load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall("a:si", NS):
        out.append("".join((node.text or "") for node in si.findall(".//a:t", NS)))
    return out


def sheet_targets(zf: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("pr:Relationship", NS)}
    out: dict[str, str] = {}
    for sheet in workbook.find("a:sheets", NS):
        name = sheet.attrib["name"]
        rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        out[name] = "xl/" + rel_map[rid]
    return out


def read_sheet_rows(zf: zipfile.ZipFile, target: str, shared: list[str]) -> list[dict[str, str]]:
    root = ET.fromstring(zf.read(target))
    rows = root.findall(".//a:sheetData/a:row", NS)
    header_row = rows[0]
    header_count = max(col_to_index(cell.attrib["r"]) for cell in header_row.findall("a:c", NS)) + 1

    matrix: list[list[str]] = []
    for row in rows:
        values = [""] * header_count
        for cell in row.findall("a:c", NS):
            idx = col_to_index(cell.attrib["r"])
            if idx >= header_count:
                continue
            cell_type = cell.attrib.get("t")
            value_node = cell.find("a:v", NS)
            raw = "" if value_node is None else (value_node.text or "")
            values[idx] = shared[int(raw)] if cell_type == "s" and raw else raw
        matrix.append(values)

    headers = matrix[0]
    return [dict(zip(headers, row)) for row in matrix[1:] if any(row)]


def load_fr24_rows() -> list[Fr24Row]:
    rows: list[Fr24Row] = []
    with FR24_CSV.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            dt = datetime.strptime(row["time"], "%Y-%m-%d %H:%M:%SZ.%f").replace(tzinfo=timezone.utc).astimezone(CST)
            rows.append(Fr24Row(local_dt=dt, raw=row))
    rows.sort(key=lambda item: item.local_dt)
    return rows


def nearest_fr24(dt: datetime, rows: list[Fr24Row]) -> tuple[Fr24Row | None, float | None]:
    if not rows:
        return None, None
    keys = [item.local_dt for item in rows]
    pos = bisect_left(keys, dt)
    candidates: list[Fr24Row] = []
    if pos < len(rows):
        candidates.append(rows[pos])
    if pos > 0:
        candidates.append(rows[pos - 1])
    if not candidates:
        return None, None
    best = min(candidates, key=lambda item: abs((item.local_dt - dt).total_seconds()))
    delta = abs((best.local_dt - dt).total_seconds())
    if delta > FR24_MATCH_MAX_DELTA_S:
        return None, delta
    return best, delta


def normalized_row(sheet: str, row: dict[str, str]) -> dict[str, object]:
    dt_local = parse_datetime(row["时间"])
    dt_utc = dt_local.astimezone(timezone.utc)

    if sheet == "track":
        altitude_ft = parse_intish(row.get("高度/ft(计算值)"))
        altitude_m = parse_float(row.get("高度/m"))
        speed_kn = parse_intish(row.get("水平速度/kn(计算值)"))
        speed_kph = parse_float(row.get("水平速度/kph"))
        vertical_speed_fpm = parse_intish(row.get("垂直速度"))
        vertical_speed_fpm_calc = parse_float(row.get("垂直速度(计算值)"))
    elif sheet == "crash":
        altitude_ft = parse_intish(row.get("高度/ft"))
        altitude_m = None if altitude_ft is None else altitude_ft * 0.3048
        speed_kn = parse_intish(row.get("水平速度/kn"))
        speed_kph = None if speed_kn is None else speed_kn * 1.852
        vertical_speed_fpm = parse_intish(row.get("垂直速度"))
        vertical_speed_fpm_calc = None
    else:
        raise ValueError(f"Unsupported sheet: {sheet}")

    return {
        "sheet_sources": sheet,
        "track_present": "1" if sheet == "track" else "0",
        "crash_present": "1" if sheet == "crash" else "0",
        "flight_no": row.get("航班号", ""),
        "route": row.get("起降地", ""),
        "aircraft_no": row.get("飞机编号", ""),
        "aircraft_type": row.get("机型", ""),
        "time_local_cst": dt_local.strftime("%Y-%m-%d %H:%M:%S.%f").rstrip("0").rstrip("."),
        "time_utc": dt_utc.isoformat().replace("+00:00", "Z"),
        "unix_time": f"{dt_utc.timestamp():.3f}",
        "longitude": parse_float(row.get("经度")),
        "latitude": parse_float(row.get("纬度")),
        "altitude_ft": altitude_ft,
        "altitude_m": altitude_m,
        "ground_speed_kn": speed_kn,
        "ground_speed_kph": speed_kph,
        "vertical_speed_fpm": vertical_speed_fpm,
        "vertical_speed_fpm_calc": vertical_speed_fpm_calc,
        "heading_deg": parse_float(row.get("航向")),
        "squawk": row.get("应答码", ""),
    }


def coalesce(primary, secondary):
    return primary if primary not in (None, "") else secondary


def merge_rows(existing: dict[str, object], incoming: dict[str, object]) -> dict[str, object]:
    merged = existing.copy()
    merged["sheet_sources"] = "+".join(sorted(set(str(existing["sheet_sources"]).split("+") + str(incoming["sheet_sources"]).split("+"))))
    merged["track_present"] = "1" if existing["track_present"] == "1" or incoming["track_present"] == "1" else "0"
    merged["crash_present"] = "1" if existing["crash_present"] == "1" or incoming["crash_present"] == "1" else "0"

    direct_from_crash = {
        "altitude_ft",
        "ground_speed_kn",
        "vertical_speed_fpm",
        "heading_deg",
        "squawk",
        "longitude",
        "latitude",
    }

    for key, value in incoming.items():
        if key in {"sheet_sources", "track_present", "crash_present"}:
            continue
        if key in direct_from_crash and incoming["crash_present"] == "1":
            merged[key] = coalesce(value, merged.get(key))
        else:
            merged[key] = coalesce(merged.get(key), value)

    if merged.get("altitude_m") in (None, "") and merged.get("altitude_ft") not in (None, ""):
        merged["altitude_m"] = float(merged["altitude_ft"]) * 0.3048
    if merged.get("ground_speed_kph") in (None, "") and merged.get("ground_speed_kn") not in (None, ""):
        merged["ground_speed_kph"] = float(merged["ground_speed_kn"]) * 1.852
    return merged


def format_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.6f}".rstrip("0").rstrip(".")
    return str(value)


def build_rows() -> list[dict[str, object]]:
    with zipfile.ZipFile(MERGED_XLSX) as zf:
        shared = load_shared_strings(zf)
        targets = sheet_targets(zf)
        normalized: dict[str, dict[str, object]] = {}

        for sheet_name in ("track", "crash"):
            for row in read_sheet_rows(zf, targets[sheet_name], shared):
                item = normalized_row(sheet_name, row)
                key = str(item["time_local_cst"])
                if key in normalized:
                    normalized[key] = merge_rows(normalized[key], item)
                else:
                    normalized[key] = item

    fr24_rows = load_fr24_rows()
    ordered = sorted(normalized.values(), key=lambda item: str(item["time_local_cst"]))
    enriched: list[dict[str, object]] = []
    for row in ordered:
        dt_local = parse_datetime(str(row["time_local_cst"]).replace("T", " "))
        match, delta = nearest_fr24(dt_local, fr24_rows)
        if match is None:
            row["fr24_match"] = "none"
            row["fr24_time_delta_s"] = ""
            row["fr24_time_utc"] = ""
            row["fr24_no_position"] = ""
            row["fr24_altitude_ft"] = ""
            row["fr24_speed_kn"] = ""
            row["fr24_track_deg"] = ""
            row["fr24_vspeed_fpm"] = ""
        else:
            row["fr24_match"] = "exact" if delta == 0 else "nearest"
            row["fr24_time_delta_s"] = f"{delta:.3f}"
            row["fr24_time_utc"] = match.raw["time"]
            row["fr24_no_position"] = match.raw["no_position"]
            row["fr24_altitude_ft"] = match.raw["altitude"]
            row["fr24_speed_kn"] = match.raw["speed"]
            row["fr24_track_deg"] = match.raw["track"]
            row["fr24_vspeed_fpm"] = match.raw["vspeed"]
        enriched.append(row)
    return enriched


def write_csv(rows: list[dict[str, object]]) -> None:
    fieldnames = [
        "sheet_sources",
        "track_present",
        "crash_present",
        "flight_no",
        "route",
        "aircraft_no",
        "aircraft_type",
        "time_local_cst",
        "time_utc",
        "unix_time",
        "longitude",
        "latitude",
        "altitude_ft",
        "altitude_m",
        "ground_speed_kn",
        "ground_speed_kph",
        "vertical_speed_fpm",
        "vertical_speed_fpm_calc",
        "heading_deg",
        "squawk",
        "fr24_match",
        "fr24_time_delta_s",
        "fr24_time_utc",
        "fr24_no_position",
        "fr24_altitude_ft",
        "fr24_speed_kn",
        "fr24_track_deg",
        "fr24_vspeed_fpm",
    ]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: format_value(row.get(key)) for key in fieldnames})


def main() -> None:
    rows = build_rows()
    write_csv(rows)
    print(f"Wrote {OUT_CSV} with {len(rows)} rows")


if __name__ == "__main__":
    main()

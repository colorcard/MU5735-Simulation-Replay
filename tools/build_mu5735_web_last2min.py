#!/usr/bin/env python3
"""Build browser-ready MU5735 replay on an ADS-B time axis."""

from __future__ import annotations

import bisect
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean, median, pstdev


ROOT = Path(__file__).resolve().parents[1]
EXACT_CSV = ROOT / "data" / "raw" / "fdr" / "ExactSample.csv"
TABLE_CSV = ROOT / "data" / "raw" / "fdr" / "TableResolution.csv"
SOURCE_CSV = ROOT / "data" / "processed" / "MU5735_FDR_ADSB_aligned.csv"
OUT_DIR = ROOT / "data" / "web_payload"
OUT_JSON = OUT_DIR / "mu5735_last2min_fused.json"
OUT_JS = OUT_DIR / "mu5735_last2min_fused.js"

TIME_STEP = 0.05
VIS_DURATION = 120.0
CST = timezone(timedelta(hours=8))

FDR_FIELDS = [
    "Pitch Angle",
    "Roll Angle",
    "Roll Rate",
    "Heading",
    "Altitude Press",
    "Ground Spd",
    "Eng1 N2 Actual",
    "Eng2 N2 Actual",
    "Eng1 Fuel Flow",
    "Eng2 Fuel Flow",
    "Eng1 N1",
    "Eng2 N1",
    "Ctrl Col Pos-L",
    "Ctrl Whl Pos-L",
    "Elevator-L",
    "Aileron-R",
    "Rudder",
    "Accel Vert",
    "Accel Long",
    "Accel Lat",
    "Absolute Roll Rate",
    "Yaw Rate",
    "Elevator-R",
    "Aileron-L",
]

EVENT_FIELDS = [
    "Eng1 Cutoff SW",
    "Eng2 Cutoff SW",
    "Eng1 Fuel Flow",
    "Eng2 Fuel Flow",
    "Eng1 N2 Actual",
    "Eng2 N2 Actual",
]

FIELD_META = {
    "Pitch Angle": {"label": "俯仰角", "unit": "deg"},
    "Roll Angle": {"label": "横滚角", "unit": "deg"},
    "Roll Rate": {"label": "滚转率", "unit": "deg/s"},
    "Heading": {"label": "航向", "unit": "deg"},
    "Altitude Press": {"label": "高度", "unit": "ft"},
    "Ground Spd": {"label": "地速", "unit": "kt"},
    "Eng1 N2 Actual": {"label": "发动机1 N2", "unit": "%"},
    "Eng2 N2 Actual": {"label": "发动机2 N2", "unit": "%"},
    "Eng1 Fuel Flow": {"label": "发动机1 燃油流量", "unit": "pph"},
    "Eng2 Fuel Flow": {"label": "发动机2 燃油流量", "unit": "pph"},
    "Eng1 N1": {"label": "发动机1 N1", "unit": "%"},
    "Eng2 N1": {"label": "发动机2 N1", "unit": "%"},
    "Ctrl Col Pos-L": {"label": "操纵杆纵向", "unit": "deg"},
    "Ctrl Whl Pos-L": {"label": "操纵盘横向", "unit": "deg"},
    "Elevator-L": {"label": "升降舵左", "unit": "deg"},
    "Elevator-R": {"label": "升降舵右", "unit": "deg"},
    "Aileron-L": {"label": "副翼左", "unit": "deg"},
    "Aileron-R": {"label": "副翼右", "unit": "deg"},
    "Rudder": {"label": "方向舵", "unit": "deg"},
    "Accel Vert": {"label": "垂直加速度", "unit": "g"},
    "Accel Long": {"label": "纵向加速度", "unit": "g"},
    "Accel Lat": {"label": "侧向加速度", "unit": "g"},
    "Absolute Roll Rate": {"label": "绝对滚转率", "unit": "deg/s"},
    "Yaw Rate": {"label": "偏航率", "unit": "deg/s"},
}

TABLE_FIELDS = ["Pitch Angle", "Roll Angle", "Heading", "Altitude Press", "Ground Spd"]


def parse_dt_local(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=CST)


def parse_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def detect_placeholder_value(field: str, value: float) -> bool:
    if field == "Altitude Press":
        return value in (-1.0, 0.0)
    if field == "Ground Spd":
        return value in (0.0, 1023.5)
    if field == "Heading":
        return value in (0.0, 359.65)
    if field in ("Pitch Angle", "Roll Angle"):
        return value in (-0.18, 0.0)
    return False


def load_exact_rows() -> tuple[dict[str, str], list[dict[str, float]], list[dict[str, float | str]]]:
    with EXACT_CSV.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    header = rows[11]
    units = rows[12]
    unit_map = {header[i]: units[i] for i in range(len(header))}
    value_rows: list[dict[str, float]] = []
    event_rows: list[dict[str, float | str]] = []
    field_index = {field: header.index(field) for field in FDR_FIELDS + EVENT_FIELDS}

    for row in rows[14:]:
        try:
            t = float(row[0])
        except Exception:
            continue

        item: dict[str, float] = {"Time": t}
        for field in FDR_FIELDS:
            raw = row[field_index[field]]
            if raw in ("", "*"):
                continue
            try:
                item[field] = float(raw)
            except ValueError:
                continue
        if len(item) > 1:
            value_rows.append(item)

        event: dict[str, float | str] = {"Time": t}
        for field in EVENT_FIELDS:
            raw = row[field_index[field]]
            if raw in ("", "*"):
                continue
            try:
                event[field] = float(raw)
            except ValueError:
                event[field] = raw
        if len(event) > 1:
            event_rows.append(event)

    return unit_map, value_rows, event_rows


def load_table_rows() -> list[dict[str, float]]:
    with TABLE_CSV.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    header = rows[11]
    field_index = {field: header.index(field) for field in TABLE_FIELDS}
    out = []
    for row in rows[14:]:
        try:
            t = float(row[0])
        except Exception:
            continue
        item = {"Time": t}
        for field, idx in field_index.items():
            raw = row[idx]
            if raw in ("", "*"):
                continue
            try:
                item[field] = float(raw)
            except ValueError:
                continue
        out.append(item)
    return out


def load_adsb_rows() -> tuple[list[dict[str, object]], float, float, float, float]:
    with SOURCE_CSV.open(encoding="utf-8-sig", newline="") as f:
        all_rows = list(csv.DictReader(f))

    offsets = []
    parsed_rows = []
    fdr_abs_values = []
    for row in all_rows:
        dt = parse_dt_local(row["time_local_cst"])
        offset = parse_float(row.get("fdr_offset_s"))
        fdr_abs = parse_float(row.get("fdr_time_abs"))
        if offset is not None:
            offsets.append(offset)
        if fdr_abs is not None:
            fdr_abs_values.append(fdr_abs)
        parsed_rows.append(
            {
                "dt": dt,
                "epoch": dt.timestamp(),
                "lon": parse_float(row["longitude"]),
                "lat": parse_float(row["latitude"]),
                "alt": parse_float(row["altitude_ft"]),
                "gs": parse_float(row["ground_speed_kn"]),
                "vs": parse_float(row["vertical_speed_fpm"]),
                "hdg": parse_float(row["heading_deg"]),
                "fdr_abs": fdr_abs,
            }
        )

    offset = median(offsets) if offsets else 0.0
    end_epoch = max(row["epoch"] for row in parsed_rows)
    start_epoch = end_epoch - VIS_DURATION
    fdr_end_abs = max(fdr_abs_values) if fdr_abs_values else float("-inf")
    window = [row for row in parsed_rows if start_epoch - 2.0 <= row["epoch"] <= end_epoch + 2.0]
    return window, offset, fdr_end_abs, start_epoch, end_epoch


def first_match(rows: list[dict[str, float | str]], field: str, start: float, end: float, predicate) -> float | None:
    for row in rows:
        t = row["Time"]
        if not isinstance(t, float) or t < start or t > end:
            continue
        value = row.get(field)
        if value is not None and predicate(value):
            return t
    return None


def last_match(rows: list[dict[str, float | str]], field: str, start: float, end: float) -> str | None:
    out = None
    for row in rows:
        t = row["Time"]
        if not isinstance(t, float) or t < start or t > end:
            continue
        value = row.get(field)
        if isinstance(value, str):
            out = value
    return out


def detect_placeholder_intervals(table_rows: list[dict[str, float]], start: float, end: float) -> list[tuple[float, float]]:
    if start > end:
        return []

    suspects = []
    for row in table_rows:
        t = row["Time"]
        if not (start - 1.0 <= t <= end + 1.0):
            continue
        count = sum(
            1
            for field in TABLE_FIELDS
            if field in row and detect_placeholder_value(field, row[field])
        )
        if count >= 2:
            suspects.append(t)

    if not suspects:
        return []

    suspects.sort()
    intervals = []
    group = [suspects[0]]
    for t in suspects[1:]:
        if t - group[-1] <= 0.07:
            group.append(t)
        else:
            intervals.append((group[0] - 0.04, group[-1] + 0.04))
            group = [t]
    intervals.append((group[0] - 0.04, group[-1] + 0.04))
    return intervals


def in_intervals(t: float, intervals: list[tuple[float, float]]) -> bool:
    return any(a <= t <= b for a, b in intervals)


def nominal_step(times: list[float], qualities: list[str]) -> float:
    observed = [times[i] for i, q in enumerate(qualities) if q == "observed"]
    if len(observed) < 2:
        return 0.25
    diffs = [round(observed[i + 1] - observed[i], 4) for i in range(len(observed) - 1) if observed[i + 1] > observed[i]]
    return median(diffs) if diffs else 0.25


def build_fdr_series(
    exact_rows: list[dict[str, float]],
    start: float,
    end: float,
    placeholder_intervals: list[tuple[float, float]],
) -> dict[str, dict[str, list[float | str]]]:
    series = {}
    for field in FDR_FIELDS:
        points = []
        for row in exact_rows:
            if field not in row:
                continue
            t = row["Time"]
            if start - 2.0 <= t <= end + 2.0:
                q = "placeholder" if in_intervals(t, placeholder_intervals) else "observed"
                points.append((t, row[field], q))
        points.sort(key=lambda item: item[0])
        series[field] = {
            "times": [t for t, _, _ in points],
            "values": [v for _, v, _ in points],
            "qualities": [q for _, _, q in points],
        }
    return series


def interpolate_series(
    spec: dict[str, list[float | str]],
    grid: list[float],
    placeholder_intervals: list[tuple[float, float]],
) -> tuple[list[float | None], list[str]]:
    times = spec["times"]
    values = spec["values"]
    qualities = spec["qualities"]
    if not times:
        return [None] * len(grid), ["missing"] * len(grid)

    obs_times = [times[i] for i, q in enumerate(qualities) if q == "observed"]
    obs_values = [values[i] for i, q in enumerate(qualities) if q == "observed"]
    nominal = nominal_step(times, qualities)
    max_gap = max(0.25, nominal * 2.5)

    out_values = []
    out_quality = []
    for t in grid:
        for candidate_idx, candidate_time in enumerate(obs_times):
            if abs(candidate_time - t) <= 0.02:
                out_values.append(float(obs_values[candidate_idx]))
                out_quality.append("observed")
                break
        else:
            pos = bisect.bisect_left(obs_times, t)
            left = pos - 1
            right = pos
            if left < 0 or right >= len(obs_times):
                out_values.append(None)
                out_quality.append("missing")
                continue
            t0 = obs_times[left]
            t1 = obs_times[right]
            if in_intervals(t, placeholder_intervals):
                out_values.append(None)
                out_quality.append("placeholder")
                continue
            if t1 - t0 > max_gap:
                out_values.append(None)
                out_quality.append("missing")
                continue
            ratio = (t - t0) / (t1 - t0)
            out_values.append(float(obs_values[left]) + ratio * (float(obs_values[right]) - float(obs_values[left])))
            out_quality.append("interpolated")
    return out_values, out_quality


def sample_adsb_scalar(
    rows: list[dict[str, object]],
    key: str,
    target_epoch: float,
    max_gap: float = 2.5,
) -> tuple[float | None, str]:
    series = [(row["epoch"], row[key]) for row in rows if row[key] is not None]
    if not series:
        return None, "missing"
    times = [item[0] for item in series]
    values = [item[1] for item in series]

    pos = bisect.bisect_left(times, target_epoch)
    if pos < len(times) and abs(times[pos] - target_epoch) <= 0.02:
        return float(values[pos]), "observed"
    if pos > 0 and abs(times[pos - 1] - target_epoch) <= 0.02:
        return float(values[pos - 1]), "observed"
    left = pos - 1
    right = pos
    if left < 0 or right >= len(times):
        return None, "missing"
    if times[right] - times[left] > max_gap:
        return None, "missing"

    v0 = float(values[left])
    v1 = float(values[right])
    if key == "hdg":
        delta = v1 - v0
        if delta > 180:
            v1 -= 360
        elif delta < -180:
            v1 += 360
    ratio = (target_epoch - times[left]) / (times[right] - times[left])
    out = v0 + ratio * (v1 - v0)
    if key == "hdg":
        out %= 360
    return out, "interpolated"


def angle_delta_deg(a: float, b: float) -> float:
    delta = b - a
    while delta > 180:
        delta -= 360
    while delta < -180:
        delta += 360
    return delta


def window_label(seconds: float) -> str:
    if abs(seconds % 60.0) < 1e-9:
        minutes = int(round(seconds / 60.0))
        return f"最后 {minutes} 分钟"
    return f"最后 {int(round(seconds))} 秒"


def merge_intervals(intervals: list[tuple[float, float]], max_gap: float) -> list[tuple[float, float]]:
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start - last_end <= max_gap:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def find_first_time(grid: list[float], values: list[float | None], predicate) -> float | None:
    for t, value in zip(grid, values):
        if value is not None and predicate(value):
            return t
    return None


def build() -> dict:
    _, exact_rows, event_rows = load_exact_rows()
    table_rows = load_table_rows()
    adsb_rows, offset, fdr_end_abs, start_epoch, end_epoch = load_adsb_rows()

    start_fdr_abs = start_epoch - offset
    end_fdr_abs = end_epoch - offset
    placeholder_intervals = detect_placeholder_intervals(table_rows, start_fdr_abs, min(end_fdr_abs, fdr_end_abs))

    grid_epoch = [round(start_epoch + i * TIME_STEP, 4) for i in range(int(round(VIS_DURATION / TIME_STEP)) + 1)]
    grid_fdr_abs = [epoch - offset for epoch in grid_epoch]
    fdr_series = build_fdr_series(exact_rows, start_fdr_abs, min(end_fdr_abs, fdr_end_abs), placeholder_intervals)

    grid_values = {}
    grid_quality = {}
    for field in FDR_FIELDS:
        values, quality = interpolate_series(fdr_series[field], grid_fdr_abs, placeholder_intervals)
        grid_values[field] = values
        grid_quality[field] = quality

    adsb_lons = []
    adsb_lats = []
    adsb_lon_quality = []
    adsb_lat_quality = []
    adsb_vs = []
    adsb_vs_quality = []
    for i, target_epoch in enumerate(grid_epoch):
        for key, field in (("alt", "Altitude Press"), ("gs", "Ground Spd"), ("hdg", "Heading")):
            value, quality = sample_adsb_scalar(adsb_rows, key, target_epoch)
            if value is not None:
                grid_values[field][i] = value
                grid_quality[field][i] = quality
            else:
                grid_values[field][i] = None
                grid_quality[field][i] = "missing"
        lon, lon_q = sample_adsb_scalar(adsb_rows, "lon", target_epoch)
        lat, lat_q = sample_adsb_scalar(adsb_rows, "lat", target_epoch)
        vs, vs_q = sample_adsb_scalar(adsb_rows, "vs", target_epoch)
        adsb_lons.append(lon)
        adsb_lats.append(lat)
        adsb_lon_quality.append(lon_q)
        adsb_lat_quality.append(lat_q)
        adsb_vs.append(vs)
        adsb_vs_quality.append(vs_q)

    baseline = {}
    for field in ("Ctrl Col Pos-L", "Ctrl Whl Pos-L", "Elevator-L", "Aileron-R", "Pitch Angle", "Roll Angle"):
        samples = [
            v
            for t, v, q in zip(grid_fdr_abs, grid_values[field], grid_quality[field])
            if (first_match(event_rows, "Eng1 Cutoff SW", start_fdr_abs, end_fdr_abs, lambda x: x == "CUTOFF") or end_fdr_abs) > t
            and v is not None
            and q != "placeholder"
        ]
        if samples:
            baseline[field] = {
                "mean": mean(samples),
                "std": pstdev(samples) if len(samples) > 1 else 0.0,
                "min": min(samples),
                "max": max(samples),
            }

    first_alt = next((v for v in grid_values["Altitude Press"] if v is not None), None)
    first_lon = next((v for v in adsb_lons if v is not None), None)
    first_lat = next((v for v in adsb_lats if v is not None), None)
    ref_lat = math.radians(first_lat) if first_lat is not None else None

    frames = []
    motion_missing_mask = []
    flight_path_values = []
    flight_path_quality = []
    heading_rate_values = []
    heading_rate_quality = []
    for i, target_epoch in enumerate(grid_epoch):
        values = {field: grid_values[field][i] for field in FDR_FIELDS}
        quality = {field: grid_quality[field][i] for field in FDR_FIELDS}

        lon = adsb_lons[i]
        lat = adsb_lats[i]
        track_x = None
        track_y = None
        if lon is not None and lat is not None and first_lon is not None and first_lat is not None and ref_lat is not None:
            track_x = (lon - first_lon) * math.cos(ref_lat) * 111320.0
            track_y = (lat - first_lat) * 110540.0

        vertical_speed = adsb_vs[i]
        if vertical_speed is None and 0 < i < len(grid_epoch) - 1:
            a0 = grid_values["Altitude Press"][i - 1]
            a1 = grid_values["Altitude Press"][i + 1]
            if a0 is not None and a1 is not None:
                vertical_speed = (a1 - a0) / (2 * TIME_STEP) * 60.0
                vs_quality = "derived"
            else:
                vs_quality = "missing"
        else:
            vs_quality = "observed" if adsb_vs_quality[i] == "observed" else ("interpolated" if adsb_vs_quality[i] == "interpolated" else "missing")

        flight_path_angle = None
        if vertical_speed is not None and values["Ground Spd"] is not None and values["Ground Spd"] > 1.0:
            ground_speed_fps = values["Ground Spd"] * 1.6878098571
            vertical_speed_fps = vertical_speed / 60.0
            flight_path_angle = math.degrees(math.atan2(vertical_speed_fps, ground_speed_fps))
            fp_quality = "derived" if vs_quality != "missing" else "missing"
        else:
            fp_quality = "missing"
        flight_path_values.append(flight_path_angle)
        flight_path_quality.append(fp_quality)

        heading_rate = None
        heading_rate_q = "missing"
        if 0 < i < len(grid_epoch) - 1:
            h0 = grid_values["Heading"][i - 1]
            h1 = grid_values["Heading"][i + 1]
            if h0 is not None and h1 is not None:
                heading_rate = angle_delta_deg(h0, h1) / (2 * TIME_STEP)
                heading_rate_q = "derived"
        heading_rate_values.append(heading_rate)
        heading_rate_quality.append(heading_rate_q)

        relative_alt = None if values["Altitude Press"] is None or first_alt is None else values["Altitude Press"] - first_alt
        derived = {
            "verticalSpeedFpm": vertical_speed,
            "trackX": track_x,
            "trackY": track_y,
            "relativeAltitudeFt": relative_alt,
            "longitude": lon,
            "latitude": lat,
            "flightPathAngleDeg": flight_path_angle,
            "headingRateDps": heading_rate,
        }
        derived_quality = {
            "verticalSpeedFpm": vs_quality,
            "trackX": "derived" if track_x is not None else "missing",
            "trackY": "derived" if track_y is not None else "missing",
            "relativeAltitudeFt": "derived" if relative_alt is not None else "missing",
            "longitude": "observed" if adsb_lon_quality[i] == "observed" else ("interpolated" if adsb_lon_quality[i] == "interpolated" else "missing"),
            "latitude": "observed" if adsb_lat_quality[i] == "observed" else ("interpolated" if adsb_lat_quality[i] == "interpolated" else "missing"),
            "flightPathAngleDeg": fp_quality,
            "headingRateDps": heading_rate_q,
        }

        motion_missing_mask.append(sum(values[field] is None for field in ("Altitude Press", "Ground Spd", "Heading")) >= 2)

        local_dt = datetime.fromtimestamp(target_epoch, tz=timezone.utc).astimezone(CST)
        frames.append(
            {
                "t": round(target_epoch - start_epoch, 4),
                "absTime": round(target_epoch, 4),
                "absLabel": local_dt.strftime("%Y-%m-%d %H:%M:%S.%f").rstrip("0").rstrip("."),
                "values": values,
                "quality": quality,
                "derived": derived,
                "derivedQuality": derived_quality,
            }
        )

    ranges = {}
    for field in FDR_FIELDS:
        valid = [v for v, q in zip(grid_values[field], grid_quality[field]) if v is not None and q != "placeholder"]
        if valid:
            ranges[field] = {"min": min(valid), "max": max(valid)}
    if flight_path_values and any(v is not None for v in flight_path_values):
        valid = [v for v in flight_path_values if v is not None]
        ranges["Flight Path Angle"] = {"min": min(valid), "max": max(valid)}
    if heading_rate_values and any(v is not None for v in heading_rate_values):
        valid = [v for v in heading_rate_values if v is not None]
        ranges["Heading Rate"] = {"min": min(valid), "max": max(valid)}

    high_descent = find_first_time(grid_epoch, adsb_vs, lambda value: value < -10000.0)
    alt_10000 = find_first_time(grid_epoch, grid_values["Altitude Press"], lambda value: value < 10000.0)
    alt_5000 = find_first_time(grid_epoch, grid_values["Altitude Press"], lambda value: value < 5000.0)
    gs_400 = find_first_time(grid_epoch, grid_values["Ground Spd"], lambda value: value < 400.0)
    both_cutoff_abs = first_match(event_rows, "Eng1 Cutoff SW", start_fdr_abs, min(end_fdr_abs, fdr_end_abs), lambda value: value == "CUTOFF")
    eng1_cutoff_initial = last_match(event_rows, "Eng1 Cutoff SW", start_fdr_abs - 5.0, start_fdr_abs + 1.0)
    eng2_cutoff_initial = last_match(event_rows, "Eng2 Cutoff SW", start_fdr_abs - 5.0, start_fdr_abs + 1.0)
    eng1_ff_zero_abs = first_match(event_rows, "Eng1 Fuel Flow", start_fdr_abs, min(end_fdr_abs, fdr_end_abs), lambda value: float(value) <= 1.0)
    eng2_ff_zero_abs = first_match(event_rows, "Eng2 Fuel Flow", start_fdr_abs, min(end_fdr_abs, fdr_end_abs), lambda value: float(value) <= 1.0)
    eng1_n2_drop_abs = find_first_time(grid_fdr_abs, grid_values["Eng1 N2 Actual"], lambda value: value < 85.0)
    eng2_n2_drop_abs = find_first_time(grid_fdr_abs, grid_values["Eng2 N2 Actual"], lambda value: value < 85.0)

    overlap_samples = sum(1 for field in ("Pitch Angle", "Roll Angle", "Ctrl Col Pos-L", "Eng1 N2 Actual") for q in grid_quality[field] if q != "missing")
    fdr_gap_before_window = max(0.0, start_fdr_abs - fdr_end_abs)
    fdr_gap_after_end = max(0.0, end_fdr_abs - fdr_end_abs)
    fdr_overlap_frames = sum(1 for q in grid_quality["Pitch Angle"] if q != "missing")
    fdr_overlap_seconds = fdr_overlap_frames * TIME_STEP
    placeholder_display_pairs = []
    for a, b in placeholder_intervals:
        if b < start_fdr_abs or a > fdr_end_abs:
            continue
        rel_a = max(0.0, a - start_fdr_abs)
        rel_b = min(VIS_DURATION, b - start_fdr_abs)
        if rel_b > rel_a:
            placeholder_display_pairs.append((rel_a, rel_b))
    placeholder_display_intervals = [
        {"start": round(a, 4), "end": round(b, 4)}
        for a, b in merge_intervals(placeholder_display_pairs, max_gap=0.18)
    ]

    anchors = [
        {"id": "ads_window_start", "t": 0.0, "title": "ADS 末段窗口开始", "detail": f"该窗口按 ADS-B 最后一条记录向前取 {window_label(VIS_DURATION).replace('最后 ', '')}；窗口起点晚于 FDR 终止约 {fdr_gap_before_window:.1f} 秒。"},
        {"id": "both_cutoff", "t": None if both_cutoff_abs is None else round(both_cutoff_abs - start_fdr_abs, 3), "title": "Cutoff 开关切入 CUTOFF", "detail": "FDR 记录到两发 Cutoff SW 由 RUN 切入 CUTOFF。"},
        {"id": "n2_drop", "t": None if eng1_n2_drop_abs is None else round(eng1_n2_drop_abs - start_fdr_abs, 3), "title": "双发 N2 开始明显下降", "detail": "发动机核心转速脱离巡航水平并进入快速衰减。"},
        {"id": "fuel_zero", "t": None if eng2_ff_zero_abs is None else round(eng2_ff_zero_abs - start_fdr_abs, 3), "title": "双发燃油流量近零", "detail": "两发燃油流量先后衰减至零或近零。"},
        {"id": "fdr_end", "t": None if fdr_overlap_seconds <= 0 else round(fdr_overlap_seconds, 3), "title": "FDR 记录终止", "detail": "此后进入纯 ADS-B 段，姿态、操纵、发动机与 Cutoff 开关不再有 FDR 直接记录。"},
        {"id": "high_descent", "t": None if high_descent is None else round(high_descent - start_epoch, 3), "title": "下沉率进入高能俯冲区", "detail": "ADS-B 垂直速度跌破 -10,000 fpm。"},
        {"id": "alt_10000", "t": None if alt_10000 is None else round(alt_10000 - start_epoch, 3), "title": "高度跌破 10,000 ft", "detail": "按 ADS-B 高度记录，飞机进入更低高度段。"},
        {"id": "gs_400", "t": None if gs_400 is None else round(gs_400 - start_epoch, 3), "title": "地速跌破 400 kt", "detail": "ADS-B 地速明显衰减。"},
        {"id": "alt_5000", "t": None if alt_5000 is None else round(alt_5000 - start_epoch, 3), "title": "高度跌破 5,000 ft", "detail": "已进入极低高度末段。"},
        {"id": "ads_record_end", "t": VIS_DURATION, "title": "ADS-B 记录终止", "detail": "本回放窗以公开 ADS-B 末条记录作为终点。"},
    ]
    anchors = [item for item in anchors if item["t"] is not None]

    start_local = datetime.fromtimestamp(start_epoch, tz=timezone.utc).astimezone(CST)
    end_local = datetime.fromtimestamp(end_epoch, tz=timezone.utc).astimezone(CST)
    label = window_label(VIS_DURATION)
    payload = {
        "meta": {
            "title": f"MU5735 ADS-B {label}回放",
            "eyebrow": f"严格依据 ADS-B Reveal {label}",
            "subtitle": f"本窗口以 ADS-B 时间轴为标准。窗口前约 {fdr_overlap_seconds:.1f} 秒仍与 FDR 有限重叠；其后约 {fdr_gap_after_end:.1f} 秒已晚于 FDR 终止，因此后段只剩 ADS-B 外部运动与严格派生量。",
            "source": "MU5735_FDR_ADSB_aligned.csv + ExactSample.csv + TableResolution.csv",
            "startTime": round(start_epoch, 4),
            "endTime": round(end_epoch, 4),
            "rangeLabel": f"{start_local.strftime('%Y-%m-%d %H:%M:%S')} — {end_local.strftime('%Y-%m-%d %H:%M:%S')}",
            "windowSummary": f"按 ADS-B 末条记录回溯 {window_label(VIS_DURATION).replace('最后 ', '')}；仅前段存在有限 FDR 重叠，后段主要为 ADS 外部运动",
            "duration": VIS_DURATION,
            "step": TIME_STEP,
            "units": {field: FIELD_META[field]["unit"] for field in FDR_FIELDS},
            "labels": {field: FIELD_META[field]["label"] for field in FDR_FIELDS},
            "placeholderIntervals": placeholder_display_intervals,
            "baseline": baseline,
            "ranges": ranges,
            "engineEvents": {
                "eng1CutoffInitial": eng1_cutoff_initial,
                "eng2CutoffInitial": eng2_cutoff_initial,
                "bothCutoffTime": None if both_cutoff_abs is None else round(both_cutoff_abs - start_fdr_abs, 4),
                "eng1FuelZeroTime": None if eng1_ff_zero_abs is None else round(eng1_ff_zero_abs - start_fdr_abs, 4),
                "eng2FuelZeroTime": None if eng2_ff_zero_abs is None else round(eng2_ff_zero_abs - start_fdr_abs, 4),
                "eng1N2DropTime": None if eng1_n2_drop_abs is None else round(eng1_n2_drop_abs - start_fdr_abs, 4),
                "eng2N2DropTime": None if eng2_n2_drop_abs is None else round(eng2_n2_drop_abs - start_fdr_abs, 4),
            },
            "phaseTransitions": {
                "fdrEndTime": None if fdr_overlap_seconds <= 0 else round(fdr_overlap_seconds, 4),
                "pureAdsStartTime": None if fdr_overlap_seconds <= 0 else round(fdr_overlap_seconds, 4),
            },
            "primaryEventText": f"前段 FDR 重叠约 {fdr_overlap_seconds:.1f}s，后段仅剩 ADS-B",
            "summaryFuelText": f"FDR 发动机数据仅覆盖前约 {fdr_overlap_seconds:.1f}s",
            "snapshotMode": "mixed",
            "noDataMessages": {
                "chart-attitude": "本窗口无 FDR 姿态记录；ADS 只能提供外部运动。",
                "chart-controls": "本窗口无 FDR 操纵记录。",
                "chart-engines": "本窗口无 FDR 发动机转速记录。",
                "chart-fuel": "本窗口无 FDR 燃油流量记录。",
            },
            "notes": [
                f"该 {window_label(VIS_DURATION).replace('最后 ', '')}窗口直接取自 ADS-B Reveal 最后一条记录向前回溯，不再以 FDR 末段为主时间轴。",
                f"该窗口前约 {fdr_overlap_seconds:.1f} 秒仍与 FDR 重叠，但后约 {fdr_gap_after_end:.1f} 秒已经晚于 FDR 记录终止，因此姿态、舵面、操纵杆、Cutoff SW、N1/N2/FF 会在后段中断。",
                "高度、地速、航向、经纬度与垂直速度采用 ADS-B 数据，并在相邻点之间做显示插值以便连续回放。",
                "轨迹角 = atan2(垂直速度, 地速)，它描述飞行路径倾角，不等同于机体俯仰角。",
                "航向变化率由 ADS 航向差分得到，它不等同于机体偏航率。",
                f"当前窗口内可用 FDR 样本计数: {overlap_samples}；该值接近 0 表明后段姿态缺失来自源数据，而不是前端漏画。",
            ],
        },
        "anchors": anchors,
        "frames": frames,
    }
    return payload


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_JS.write_text("window.MU5735_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_JS}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Align MU5735 fused ADS-B data with local FDR CSV data."""

from __future__ import annotations

import bisect
import csv
import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FDR_CSV = ROOT / "data" / "raw" / "fdr" / "ExactSample.csv"
TABLE_CSV = ROOT / "data" / "raw" / "fdr" / "TableResolution.csv"
ADSB_CSV = ROOT / "data" / "processed" / "MU5735_ADSB_reveal_fused.csv"
OUT_ALL = ROOT / "data" / "processed" / "MU5735_FDR_ADSB_aligned.csv"
OUT_OVERLAP = ROOT / "data" / "processed" / "MU5735_FDR_ADSB_overlap.csv"
OUT_LAST5 = ROOT / "data" / "processed" / "MU5735_FDR_ADSB_last5min_aligned.csv"
OUT_META = ROOT / "data" / "processed" / "MU5735_FDR_ADSB_alignment_meta.json"

CST = timezone(timedelta(hours=8))

NUMERIC_FIELDS = [
    "Altitude Press",
    "Ground Spd",
    "Heading",
    "Pitch Angle",
    "Roll Angle",
    "Roll Rate",
    "Absolute Roll Rate",
    "Yaw Rate",
    "Accel Vert",
    "Accel Long",
    "Accel Lat",
    "Ctrl Col Pos-L",
    "Ctrl Whl Pos-L",
    "Elevator-L",
    "Elevator-R",
    "Aileron-L",
    "Aileron-R",
    "Rudder",
    "Eng1 Fuel Flow",
    "Eng2 Fuel Flow",
    "Eng1 N1",
    "Eng2 N1",
    "Eng1 N2 Actual",
    "Eng2 N2 Actual",
]
STATE_FIELDS = [
    "Eng1 Cutoff SW",
    "Eng2 Cutoff SW",
]
ALL_FDR_FIELDS = NUMERIC_FIELDS + STATE_FIELDS
ALIGNMENT_FIELDS = ["Altitude Press", "Ground Spd", "Heading"]
TABLE_FALLBACK_FIELDS = ["Altitude Press", "Ground Spd", "Heading", "Pitch Angle", "Roll Angle"]
ALIGNMENT_WINDOW_START = "2022-03-21 14:20:40"
ALIGNMENT_WINDOW_END = "2022-03-21 14:21:20"


@dataclass
class NumericSeries:
    times: list[float]
    values: list[float]
    nominal_step: float
    max_gap: float


@dataclass
class StateSeries:
    times: list[float]
    values: list[str]


def parse_adsb_dt(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=CST)


def load_adsb_rows() -> list[dict[str, str]]:
    with ADSB_CSV.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_fdr_series() -> tuple[dict[str, NumericSeries], dict[str, StateSeries], float, float]:
    with FDR_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))

    header = rows[11]
    index = {field: header.index(field) for field in ["Time"] + ALL_FDR_FIELDS}
    numeric: dict[str, list[tuple[float, float]]] = {field: [] for field in NUMERIC_FIELDS}
    state: dict[str, list[tuple[float, str]]] = {field: [] for field in STATE_FIELDS}

    min_time = float("inf")
    max_time = float("-inf")
    for row in rows[14:]:
        try:
            t = float(row[index["Time"]])
        except Exception:
            continue
        min_time = min(min_time, t)
        max_time = max(max_time, t)

        for field in NUMERIC_FIELDS:
            raw = row[index[field]]
            if raw in ("", "*"):
                continue
            try:
                numeric[field].append((t, float(raw)))
            except ValueError:
                continue

        for field in STATE_FIELDS:
            raw = row[index[field]]
            if raw in ("", "*"):
                continue
            state[field].append((t, raw))

    numeric_series: dict[str, NumericSeries] = {}
    for field, pairs in numeric.items():
        pairs.sort()
        times = [t for t, _ in pairs]
        values = [v for _, v in pairs]
        diffs = [times[i + 1] - times[i] for i in range(len(times) - 1) if times[i + 1] > times[i]]
        nominal = median(diffs) if diffs else 0.25
        numeric_series[field] = NumericSeries(
            times=times,
            values=values,
            nominal_step=nominal,
            max_gap=max(0.25, nominal * 2.5),
        )

    state_series: dict[str, StateSeries] = {}
    for field, pairs in state.items():
        pairs.sort()
        state_series[field] = StateSeries(
            times=[t for t, _ in pairs],
            values=[v for _, v in pairs],
        )

    return numeric_series, state_series, min_time, max_time


def table_placeholder(field: str, value: float) -> bool:
    if field == "Altitude Press":
        return value in (-1.0, 0.0)
    if field == "Ground Spd":
        return value in (0.0, 1023.5)
    if field == "Heading":
        return value in (0.0, 359.65)
    if field == "Pitch Angle":
        return value in (-0.18, 0.0)
    if field == "Roll Angle":
        return value in (-0.18, 0.0)
    return False


def load_table_series() -> dict[str, NumericSeries]:
    with TABLE_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))

    header = rows[11]
    index = {field: header.index(field) for field in ["Time"] + TABLE_FALLBACK_FIELDS}
    numeric: dict[str, list[tuple[float, float]]] = {field: [] for field in TABLE_FALLBACK_FIELDS}

    for row in rows[14:]:
        try:
            t = float(row[index["Time"]])
        except Exception:
            continue
        for field in TABLE_FALLBACK_FIELDS:
            raw = row[index[field]]
            if raw in ("", "*"):
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            if table_placeholder(field, value):
                continue
            numeric[field].append((t, value))

    numeric_series: dict[str, NumericSeries] = {}
    for field, pairs in numeric.items():
        pairs.sort()
        times = [t for t, _ in pairs]
        values = [v for _, v in pairs]
        diffs = [times[i + 1] - times[i] for i in range(len(times) - 1) if times[i + 1] > times[i]]
        nominal = median(diffs) if diffs else 0.25
        numeric_series[field] = NumericSeries(
            times=times,
            values=values,
            nominal_step=nominal,
            max_gap=max(0.25, nominal * 2.5),
        )
    return numeric_series


def median(values: list[float]) -> float:
    if not values:
        return 0.25
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def interpolate_numeric(series: NumericSeries, target_time: float) -> tuple[float | None, str]:
    times = series.times
    values = series.values
    pos = bisect.bisect_left(times, target_time)

    for candidate in (pos, pos - 1):
        if 0 <= candidate < len(times) and abs(times[candidate] - target_time) <= 0.02:
            return values[candidate], "observed"

    left = pos - 1
    right = pos
    if left < 0 or right >= len(times):
        return None, "missing"

    t0 = times[left]
    t1 = times[right]
    if (t1 - t0) > series.max_gap:
        return None, "missing"

    ratio = (target_time - t0) / (t1 - t0)
    return values[left] + ratio * (values[right] - values[left]), "interpolated"


def sample_state(series: StateSeries, target_time: float, tolerance: float = 1.0) -> tuple[str | None, str]:
    pos = bisect.bisect_left(series.times, target_time)
    candidates: list[tuple[float, str]] = []
    if pos < len(series.times):
        candidates.append((series.times[pos], series.values[pos]))
    if pos > 0:
        candidates.append((series.times[pos - 1], series.values[pos - 1]))
    if not candidates:
        return None, "missing"
    best_time, best_value = min(candidates, key=lambda item: abs(item[0] - target_time))
    if abs(best_time - target_time) > tolerance:
        return None, "missing"
    return best_value, "nearest"


def infer_offset(adsb_rows: list[dict[str, str]], numeric_series: dict[str, NumericSeries]) -> tuple[float, dict[str, float]]:
    window_rows = []
    for row in adsb_rows:
        if not (ALIGNMENT_WINDOW_START <= row["time_local_cst"] <= ALIGNMENT_WINDOW_END):
            continue
        window_rows.append(
            {
                "unix": parse_adsb_dt(row["time_local_cst"]).timestamp(),
                "Altitude Press": float(row["altitude_ft"]) if row["altitude_ft"] else None,
                "Ground Spd": float(row["ground_speed_kn"]) if row["ground_speed_kn"] else None,
                "Heading": float(row["heading_deg"]) if row["heading_deg"] else None,
            }
        )

    weights = {"Altitude Press": 1 / 5000, "Ground Spd": 1 / 100, "Heading": 1 / 30}

    def score(offset: float) -> tuple[float, int]:
        local_errors = []
        matched = 0
        for row in window_rows:
            sample_time = row["unix"] - offset
            point_errors = []
            for field in ALIGNMENT_FIELDS:
                value, quality = interpolate_numeric(numeric_series[field], sample_time)
                if quality == "missing" or value is None or row[field] is None:
                    continue
                delta = abs(value - row[field])
                if field == "Heading":
                    delta = min(delta, 360 - delta)
                point_errors.append((delta * weights[field]) ** 2)
            if point_errors:
                local_errors.append(sum(point_errors) / len(point_errors))
                matched += 1
        if not local_errors:
            return float("inf"), 0
        return math.sqrt(sum(local_errors) / len(local_errors)), matched

    coarse = []
    for offset in range(1647554500, 1647554801):
        rmse, matched = score(float(offset))
        coarse.append((rmse, -matched, float(offset)))
    coarse.sort()
    base = coarse[0][2]

    refined = []
    for i in range(-20, 21):
        offset = base + i * 0.1
        rmse, matched = score(offset)
        refined.append((rmse, -matched, offset))
    refined.sort()
    best_rmse, best_negative_matched, best_offset = refined[0]
    return best_offset, {"rmse": best_rmse, "matched_rows": -best_negative_matched}


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.6f}".rstrip("0").rstrip(".")


def sample_numeric_with_fallback(
    field: str,
    sample_time: float,
    primary: dict[str, NumericSeries],
    fallback: dict[str, NumericSeries],
) -> tuple[float | None, str]:
    value, quality = interpolate_numeric(primary[field], sample_time)
    if quality != "missing" or field not in fallback:
        return value, quality
    fallback_value, fallback_quality = interpolate_numeric(fallback[field], sample_time)
    if fallback_quality == "missing":
        return fallback_value, fallback_quality
    return fallback_value, f"table_{fallback_quality}"


def build_aligned_rows() -> tuple[list[dict[str, str]], dict[str, object]]:
    adsb_rows = load_adsb_rows()
    numeric_series, state_series, fdr_min_time, fdr_max_time = load_fdr_series()
    table_series = load_table_series()
    offset, offset_meta = infer_offset(adsb_rows, numeric_series)

    output_rows: list[dict[str, str]] = []
    overlap_count = 0
    for row in adsb_rows:
        local_dt = parse_adsb_dt(row["time_local_cst"])
        fdr_time = local_dt.timestamp() - offset
        in_range = fdr_min_time <= fdr_time <= fdr_max_time

        out = dict(row)
        out["fdr_overlap"] = "1" if in_range else "0"
        out["fdr_offset_s"] = f"{offset:.3f}"
        out["fdr_time_abs"] = format_number(fdr_time) if in_range else ""
        out["seconds_to_fdr_end"] = format_number(fdr_max_time - fdr_time) if in_range else ""
        out["fdr_time_local_cst"] = (
            datetime.fromtimestamp(fdr_time + offset, tz=timezone.utc).astimezone(CST).strftime("%Y-%m-%d %H:%M:%S.%f").rstrip("0").rstrip(".")
            if in_range
            else ""
        )

        if in_range:
            overlap_count += 1

        for field in NUMERIC_FIELDS:
            value, quality = sample_numeric_with_fallback(field, fdr_time, numeric_series, table_series) if in_range else (None, "missing")
            out[f"fdr_{slug(field)}"] = format_number(value)
            out[f"fdr_{slug(field)}_quality"] = quality if in_range else "missing"

        for field in STATE_FIELDS:
            value, quality = sample_state(state_series[field], fdr_time) if in_range else (None, "missing")
            out[f"fdr_{slug(field)}"] = value or ""
            out[f"fdr_{slug(field)}_quality"] = quality if in_range else "missing"

        output_rows.append(out)

    meta = {
        "offset_seconds": round(offset, 3),
        "offset_fit_rmse": round(float(offset_meta["rmse"]), 6),
        "offset_fit_matched_rows": int(offset_meta["matched_rows"]),
        "fdr_time_range": {
            "min_abs": round(fdr_min_time, 4),
            "max_abs": round(fdr_max_time, 4),
            "min_local_cst": datetime.fromtimestamp(fdr_min_time + offset, tz=timezone.utc).astimezone(CST).isoformat(),
            "max_local_cst": datetime.fromtimestamp(fdr_max_time + offset, tz=timezone.utc).astimezone(CST).isoformat(),
        },
        "adsb_rows": len(adsb_rows),
        "overlap_rows": overlap_count,
    }
    return output_rows, meta


def slug(field: str) -> str:
    return (
        field.lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace("-", "_")
        .replace("(", "")
        .replace(")", "")
    )


def write_outputs(rows: list[dict[str, str]], meta: dict[str, object]) -> None:
    base_fields = list(rows[0].keys())
    with OUT_ALL.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=base_fields)
        writer.writeheader()
        writer.writerows(rows)

    overlap_rows = [row for row in rows if row["fdr_overlap"] == "1"]
    with OUT_OVERLAP.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=base_fields)
        writer.writeheader()
        writer.writerows(overlap_rows)

    if overlap_rows:
        overlap_end = max(parse_adsb_dt(row["time_local_cst"]) for row in overlap_rows)
        cutoff = overlap_end - timedelta(minutes=5)
        last5_rows = [row for row in overlap_rows if parse_adsb_dt(row["time_local_cst"]) >= cutoff]
    else:
        last5_rows = []

    with OUT_LAST5.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=base_fields)
        writer.writeheader()
        writer.writerows(last5_rows)

    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    rows, meta = build_aligned_rows()
    write_outputs(rows, meta)
    print(f"Wrote {OUT_ALL} with {len(rows)} rows")
    print(f"Wrote {OUT_OVERLAP} with {meta['overlap_rows']} overlap rows")
    print(f"Wrote {OUT_LAST5}")
    print(f"Wrote {OUT_META}")


if __name__ == "__main__":
    main()

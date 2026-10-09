"""净山湖双球局 GPS 数据分析。

该脚本只读取现场导出、候选数据和影像元数据，输出均为本地私有派生文件。
不修改原始 JSON、正式 course.geojson 或候选数据。
"""

from __future__ import annotations

import argparse
import csv
import json
import hashlib
import math
import statistics
import subprocess
from functools import lru_cache
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable

# Windows 环境未必安装 IANA tzdata；2026 年上海使用 UTC+8，无夏令时。
SHANGHAI = timezone(timedelta(hours=8), name="Asia/Shanghai")
HOLES = range(1, 19)
NEAR_DUP_SECONDS = 20.0
NEAR_DUP_METRES = 5.0
JUMP_SPEED_MPS = 15.0
CONFLICT_METRES = 80.0


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def invalid_record(record: dict[str, Any]) -> list[str]:
    """Return machine-readable validation flags without mutating source data."""
    reasons: list[str] = []
    timestamp = record.get("timestamp")
    try:
        parse_time(str(timestamp))
    except (TypeError, ValueError):
        reasons.append("invalid-timestamp")
    spatial = record.get("recordKind") != "confirmationEvent"
    for key in ("latitude", "longitude") if spatial else ():
        value = record.get(key)
        if not finite_number(value):
            reasons.append(f"invalid-{key}")
    if isinstance(record.get("latitude"), (int, float)) and not -90 <= float(record["latitude"]) <= 90:
        reasons.append("latitude-out-of-range")
    if isinstance(record.get("longitude"), (int, float)) and not -180 <= float(record["longitude"]) <= 180:
        reasons.append("longitude-out-of-range")
    accuracy = record.get("accuracy")
    if spatial and (not finite_number(accuracy) or accuracy < 0):
        reasons.append("invalid-accuracy")
    if record.get("recordKind") in {"sample", "track"} and not record.get("id"):
        reasons.append("missing-id")
    hole = record.get("actualHole")
    if hole is not None and hole != "uncertain" and (type(hole) is not int or hole not in HOLES):
        reasons.append("invalid-hole")
    if record.get("recordKind") == "sample" and (type(hole) is not int or hole not in HOLES):
        reasons.append("missing-or-invalid-sample-hole")
    if record.get("recordKind") == "sample" and record.get("sampleType") not in {"tee", "green"}:
        reasons.append("invalid-sample-type")
    return reasons


def usable_position(record: dict[str, Any]) -> bool:
    return (finite_number(record.get("latitude")) and -90 <= record["latitude"] <= 90
            and finite_number(record.get("longitude")) and -180 <= record["longitude"] <= 180
            and "invalid-timestamp" not in record.get("invalidReasons", []))


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("时间必须包含 UTC/时区信息")
    return parsed.astimezone(timezone.utc)


def local_date(value: str) -> str:
    return parse_time(value).astimezone(SHANGHAI).date().isoformat()


def haversine_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    radius = 6_371_000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.asin(math.sqrt(min(1.0, h)))


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} 顶层必须是对象")
    return value


def validate_export(value: dict[str, Any], path: Path) -> list[str]:
    issues: list[str] = []
    for key in ("schemaVersion", "session", "samples", "confirmationEvents", "track", "metadata"):
        if key not in value:
            issues.append(f"{path.name}: 缺少 {key}")
    if value.get("schemaVersion") != 1:
        issues.append(f"{path.name}: schemaVersion 不是 1")
    session = value.get("session")
    if not isinstance(session, dict) or not isinstance(session.get("sessionId"), str):
        issues.append(f"{path.name}: session/sessionId 无效")
    for key in ("samples", "confirmationEvents", "track"):
        if not isinstance(value.get(key), list):
            issues.append(f"{path.name}: {key} 不是数组")
    expected_session_id = session.get("sessionId") if isinstance(session, dict) else None
    for kind in ("samples", "track"):
        for index, record in enumerate(value.get(kind, []) if isinstance(value.get(kind), list) else []):
            if not isinstance(record, dict):
                issues.append(f"{path.name}: {kind}[{index}] 不是对象")
                continue
            for key in ("id", "sessionId", "timestamp", "latitude", "longitude", "accuracy"):
                if key not in record:
                    issues.append(f"{path.name}: {kind}[{index}] 缺少 {key}")
            try:
                parse_time(str(record.get("timestamp")))
            except (TypeError, ValueError):
                issues.append(f"{path.name}: {kind}[{index}] timestamp 无效")
            if expected_session_id and record.get("sessionId") != expected_session_id:
                issues.append(f"{path.name}: {kind}[{index}] sessionId 与顶层 session 不一致")
            if kind == "samples" and not isinstance(record.get("candidateMapping", {}), (dict, type(None))):
                issues.append(f"{path.name}: samples[{index}] candidateMapping 必须是对象或 null")
    for index, record in enumerate(value.get("confirmationEvents", []) if isinstance(value.get("confirmationEvents"), list) else []):
        if not isinstance(record, dict):
            issues.append(f"{path.name}: confirmationEvents[{index}] 不是对象")
            continue
        for key in ("timestamp", "predictedHole", "actualHole", "confirmationSource"):
            if key not in record:
                issues.append(f"{path.name}: confirmationEvents[{index}] 缺少 {key}")
        try:
            parse_time(str(record.get("timestamp")))
        except (TypeError, ValueError):
            issues.append(f"{path.name}: confirmationEvents[{index}] timestamp 无效")
    return issues


def flatten_exports(paths: Iterable[Path]) -> tuple[list[dict[str, Any]], list[str], dict[str, dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    issues: list[str] = []
    exports: dict[str, dict[str, Any]] = {}
    for path in paths:
        document = read_json(path)
        # 旧版可以没有轨迹和确认事件；显式错误类型不能静默变成空数组。
        document.setdefault("track", [])
        document.setdefault("confirmationEvents", [])
        if not isinstance(document.get("session"), dict) or any(not isinstance(document.get(k), list) for k in ("samples", "track", "confirmationEvents")):
            raise ValueError(f"{path.name}: session 或记录数组结构无效")
        if not isinstance(document.get("metadata", {}), dict):
            raise ValueError(f"{path.name}: metadata 必须是对象")
        if path.name in exports:
            raise ValueError("输入文件 basename 必须互不相同，避免来源混淆")
        issues.extend(validate_export(document, path))
        exports[path.name] = document
        for kind, key in (("sample", "samples"), ("track", "track"), ("confirmationEvent", "confirmationEvents")):
            for index, record in enumerate(document.get(key, [])):
                if not isinstance(record, dict):
                    continue
                item = dict(record)
                if kind == "sample" and not isinstance(item.get("candidateMapping", {}), (dict, type(None))):
                    raise ValueError(f"{path.name}: samples[{index}] candidateMapping 必须是对象或 null")
                item["recordKind"] = kind
                item["sourceFile"] = path.name
                item["sourceSessionId"] = document.get("session", {}).get("sessionId")
                item["sourceExportedAt"] = document.get("metadata", {}).get("exportedAt")
                item["originalId"] = item.get("id")
                item["sourceRecordIndex"] = index
                item["invalidReasons"] = invalid_record(item)
                item["localDate"] = None if "invalid-timestamp" in item["invalidReasons"] else local_date(str(item["timestamp"]))
                if kind == "sample":
                    item["teeFieldsPresentInSource"] = {k: k in record for k in ("teeCategory", "teeSelectionStatus")}
                    # 不从导出时 holeTees 的最终状态回填历史样本。
                    item.setdefault("teeCategory", "unknown")
                    item.setdefault("teeSelectionStatus", "unknown")
                # 保留原始内容指纹，识别坐标之外的版本差异；不回填任何历史字段。
                item["sourceContentSha256"] = hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                if kind == "confirmationEvent" and not item.get("id"):
                    item["id"] = "event-content-" + hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
                records.append(item)
    return records, issues, exports


def dedupe_records(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    duplicates: list[dict[str, Any]] = []
    for record in records:
        # 缺 ID 的记录保留在私有数据中并标异常，不丢弃也不冒充原始 ID。
        key = (record["recordKind"], record.get("id") or f"missing:{record['sourceFile']}:{record['sourceRecordIndex']}")
        if key in seen:
            original = seen[key]
            fields = ("sessionId", "timestamp", "latitude", "longitude", "accuracy", "actualHole", "sampleType", "teeCategory", "teeSelectionStatus")
            conflicts = [k for k in fields if k in record and k in original and record[k] != original[k]]
            if (record.get("sourceContentSha256") and original.get("sourceContentSha256")
                    and record["sourceContentSha256"] != original["sourceContentSha256"]):
                conflicts.append("original-content")
            duplicates.append({"reason": "duplicate-id-content-conflict" if conflicts else "duplicate-id", "key": list(key), "keptSource": original["sourceFile"], "duplicateSource": record["sourceFile"], "id": record["id"], "conflictingFields": conflicts, "duplicateRecord": record})
            original.setdefault("allSources", [original["sourceFile"]]).append(record["sourceFile"])
            if conflicts:
                original["dedupeContentConflict"] = True
        else:
            seen[key] = record
    return list(seen.values()), duplicates


def find_near_duplicates(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    by_group: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if record["recordKind"] not in {"sample", "track"} or not usable_position(record):
            continue
        by_group[(record.get("sessionId"), record["localDate"], record["recordKind"], record.get("sampleType"))].append(record)
    for group, values in by_group.items():
        ordered = sorted(values, key=lambda item: parse_time(item["timestamp"]))
        for i, left in enumerate(ordered):
            for right in ordered[i + 1:]:
                dt = (parse_time(right["timestamp"]) - parse_time(left["timestamp"])).total_seconds()
                if dt > NEAR_DUP_SECONDS:
                    break
                distance = haversine_m(left["latitude"], left["longitude"], right["latitude"], right["longitude"])
                if distance <= NEAR_DUP_METRES:
                    result.append({"group": list(group), "firstId": left.get("id"), "secondId": right.get("id"), "firstHole": left.get("actualHole"), "secondHole": right.get("actualHole"), "timeSeconds": round(dt, 3), "distanceMetres": round(distance, 3)})
    return result


def percentiles(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"min": None, "p50": None, "p90": None, "max": None, "mean": None}
    values = sorted(values)
    def pick(q: float) -> float:
        index = (len(values) - 1) * q
        low, high = math.floor(index), math.ceil(index)
        if low == high:
            return values[low]
        return values[low] + (values[high] - values[low]) * (index - low)
    return {"min": round(values[0], 3), "p50": round(pick(0.5), 3), "p90": round(pick(0.9), 3), "max": round(values[-1], 3), "mean": round(statistics.mean(values), 3)}


def nearest_object(record: dict[str, Any], objects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = []
    for obj in objects:
        lon, lat = obj["center"]["coordinates"]
        ranked.append({"id": obj["id"], "distanceMetres": haversine_m(record["latitude"], record["longitude"], lat, lon)})
    return sorted(ranked, key=lambda item: item["distanceMetres"])


@lru_cache(maxsize=1)
def metric_transformer():
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:4326", "EPSG:4548", always_xy=True)


def _project_local(lon: float, lat: float, ref_lon: float, ref_lat: float) -> tuple[float, float]:
    transformer = metric_transformer()
    x, y = transformer.transform(lon, lat, errcheck=True)
    rx, ry = transformer.transform(ref_lon, ref_lat, errcheck=True)
    return x - rx, y - ry


def _point_segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    for index, (x1, y1) in enumerate(ring):
        x2, y2 = ring[index - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def geometry_distance_metres(record: dict[str, Any], obj: dict[str, Any]) -> float | None:
    geometry = obj.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "LineString"}:
        return None
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return None
    ref_lon, ref_lat = float(record["longitude"]), float(record["latitude"])
    raw_rings = coordinates if geometry["type"] == "Polygon" else [coordinates]
    rings = [[_project_local(float(p[0]), float(p[1]), ref_lon, ref_lat) for p in ring] for ring in raw_rings]
    point = (0.0, 0.0)
    if geometry["type"] == "Polygon" and _point_in_ring(*point, rings[0]) and not any(_point_in_ring(*point, r) for r in rings[1:]):
        return 0.0
    return min(_point_segment_distance(0.0, 0.0, a[0], a[1], b[0], b[1]) for ring in rings for a, b in zip(ring, ring[1:]))


def spatial_evidence(record: dict[str, Any], objects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for obj in objects:
        center_lon, center_lat = obj["center"]["coordinates"]
        center_distance = haversine_m(record["latitude"], record["longitude"], center_lat, center_lon)
        boundary_distance = geometry_distance_metres(record, obj)
        ranked.append({"id": obj["id"], "centerDistanceMetres": round(center_distance, 2), "boundaryDistanceMetres": round(boundary_distance, 2) if boundary_distance is not None else None, "source": obj.get("source"), "status": obj.get("status")})
    return sorted(ranked, key=lambda item: (item["boundaryDistanceMetres"] if item["boundaryDistanceMetres"] is not None else item["centerDistanceMetres"]))


def candidate_lookup(candidates: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    tees = {item["id"]: item for item in candidates.get("teeZones", [])}
    greens = {item["id"]: item for item in candidates.get("greenClassifications", [])}
    return tees, greens


def round_stats(round_records: list[dict[str, Any]], tees: dict[str, Any], greens: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    samples = [r for r in round_records if r["recordKind"] == "sample"]
    tracks = [r for r in round_records if r["recordKind"] == "track"]
    holes: dict[int, dict[str, Any]] = {}
    for hole in HOLES:
        values = [s for s in samples if s.get("actualHole") == hole]
        tees_here = [s for s in values if s.get("sampleType") == "tee"]
        greens_here = [s for s in values if s.get("sampleType") == "green"]
        distances: list[dict[str, Any]] = []
        for sample in values:
            if not usable_position(sample):
                continue
            objects = tees if sample.get("sampleType") == "tee" else greens
            nearest = spatial_evidence(sample, list(objects.values()))
            mapping = sample.get("candidateMapping") or {}
            mapped_id = mapping.get("teeZoneId") if sample.get("sampleType") == "tee" else mapping.get("greenId")
            mapped = next((x for x in nearest if x["id"] == mapped_id), None)
            distances.append({"id": sample["id"], "sampleType": sample.get("sampleType"), "accuracyMetres": sample.get("accuracy"), "mappedId": mapped_id, "mappedCenterDistanceMetres": mapped["centerDistanceMetres"] if mapped else None, "mappedBoundaryDistanceMetres": mapped["boundaryDistanceMetres"] if mapped else None, "nearest": nearest[:3]})
        by_type: dict[str, Any] = {}
        for typ, group in (("tee", tees_here), ("green", greens_here)):
            accuracies = [float(x["accuracy"]) for x in group if finite_number(x.get("accuracy")) and x["accuracy"] >= 0]
            by_type[typ] = {"count": len(group), "accuracyMetres": percentiles(accuracies), "missing": len(group) == 0, "mappedIds": sorted({((x.get("candidateMapping") or {}).get("teeZoneId" if typ == "tee" else "greenId")) for x in group if ((x.get("candidateMapping") or {}).get("teeZoneId" if typ == "tee" else "greenId"))})}
        tee_categories = [{"category": x.get("teeCategory", "unknown"), "selectionStatus": x.get("teeSelectionStatus", "unknown")} for x in tees_here]
        holes[hole] = {"hole": hole, "tee": by_type["tee"], "green": by_type["green"], "teeCategories": tee_categories, "sampleConsistencyMetres": {typ: percentiles([haversine_m(a["latitude"], a["longitude"], b["latitude"], b["longitude"]) for i, a in enumerate(group) for b in group[i + 1:] if usable_position(a) and usable_position(b)]) for typ, group in (("tee", tees_here), ("green", greens_here))}, "nearestComparisons": distances}
    speeds = [float(x["speed"]) for x in samples if finite_number(x.get("speed")) and x["speed"] >= 0]
    jumps: list[dict[str, Any]] = []
    ordered_tracks = sorted([t for t in tracks if usable_position(t)], key=lambda item: parse_time(item["timestamp"]))
    same_timestamp_conflicts: list[dict[str, Any]] = []
    gap_anomalies: list[dict[str, Any]] = []
    hole_switches: list[dict[str, Any]] = []
    for left, right in zip(ordered_tracks, ordered_tracks[1:]):
        dt = (parse_time(right["timestamp"]) - parse_time(left["timestamp"])).total_seconds()
        if dt <= 0:
            if dt == 0 and (left.get("latitude"), left.get("longitude")) != (right.get("latitude"), right.get("longitude")):
                same_timestamp_conflicts.append({"firstId": left["id"], "secondId": right["id"], "firstHole": left.get("actualHole"), "secondHole": right.get("actualHole")})
            continue
        distance = haversine_m(left["latitude"], left["longitude"], right["latitude"], right["longitude"])
        speed = distance / dt
        if dt > 600:
            gap_anomalies.append({"firstId": left["id"], "secondId": right["id"], "gapSeconds": round(dt, 1), "firstHole": left.get("actualHole"), "secondHole": right.get("actualHole")})
        if left.get("actualHole") != right.get("actualHole"):
            hole_switches.append({"firstId": left["id"], "secondId": right["id"], "gapSeconds": round(dt, 1), "distanceMetres": round(distance, 2), "firstHole": left.get("actualHole"), "secondHole": right.get("actualHole")})
        if speed > JUMP_SPEED_MPS:
            jumps.append({"firstId": left["id"], "secondId": right["id"], "timeSeconds": round(dt, 3), "distanceMetres": round(distance, 2), "speedMps": round(speed, 2), "firstHole": left.get("actualHole"), "secondHole": right.get("actualHole")})
    accuracies = [float(x["accuracy"]) for x in samples if finite_number(x.get("accuracy")) and x["accuracy"] >= 0]
    stats = {"date": round_records[0]["localDate"] if round_records else None, "sampleCount": len(samples), "trackCount": len(tracks), "confirmationEventCount": sum(1 for x in round_records if x["recordKind"] == "confirmationEvent"), "teeCount": sum(1 for x in samples if x.get("sampleType") == "tee"), "greenCount": sum(1 for x in samples if x.get("sampleType") == "green"), "coveredHoles": [h for h in HOLES if holes[h]["tee"]["count"] or holes[h]["green"]["count"]], "completeTeeGreenHoles": [h for h in HOLES if holes[h]["tee"]["count"] and holes[h]["green"]["count"]], "accuracyMetres": percentiles(accuracies), "speedMps": percentiles(speeds), "speedAnomalies": [{"id": x["id"], "speedMps": x["speed"], "hole": x.get("actualHole"), "sampleType": x.get("sampleType")} for x in samples if isinstance(x.get("speed"), (int, float)) and x.get("speed") is not None and float(x["speed"]) > 8], "trackJumpAnomalies": jumps, "sameTimestampPositionConflicts": same_timestamp_conflicts, "trackGaps": gap_anomalies, "holeSwitches": hole_switches, "holes": holes}
    stats["accuracyByKind"] = {kind: percentiles([float(r["accuracy"]) for r in group if finite_number(r.get("accuracy")) and r["accuracy"] >= 0]) for kind, group in (("tee", [s for s in samples if s.get("sampleType") == "tee"]), ("green", [s for s in samples if s.get("sampleType") == "green"]), ("track", tracks))}
    stats["accuracyBands"] = {kind: {"le10": sum(finite_number(r.get("accuracy")) and 0 <= r["accuracy"] <= 10 for r in group), "10to25": sum(finite_number(r.get("accuracy")) and 10 < r["accuracy"] <= 25 for r in group), "gt25": sum(finite_number(r.get("accuracy")) and r["accuracy"] > 25 for r in group)} for kind, group in (("sample", samples), ("track", tracks))}
    stats["sampleTrackSupport"] = track_support(samples, tracks)
    stats["sampleHoleSwitchFlags"] = sample_hole_switches(samples)
    return stats, jumps


def track_support(samples: list[dict[str, Any]], tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """同时检查时间和空间；同 GPS fix 只证明记录一致，不是独立佐证。"""
    result = []
    valid_tracks = [t for t in tracks if usable_position(t)]
    for sample in samples:
        if not usable_position(sample):
            result.append({"id": sample.get("id"), "hole": sample.get("actualHole"), "status": "invalid-position-or-time"})
            continue
        near = []
        for track in valid_tracks:
            dt = abs((parse_time(track["timestamp"]) - parse_time(sample["timestamp"])).total_seconds())
            if dt <= 60:
                distance = haversine_m(sample["latitude"], sample["longitude"], track["latitude"], track["longitude"])
                near.append((dt, distance, track))
        same_hole = [x for x in near if x[2].get("actualHole") == sample.get("actualHole")]
        close = [x for x in same_hole if x[1] <= 30]
        shared = [x for x in close if x[0] == 0 and x[1] < 0.01]
        separate = [x for x in close if x[0] > 0]
        status = "separate-fix-nearby" if separate else "shared-fix-only" if shared else "same-hole-position-conflict" if same_hole else "other-hole-only" if near else "no-track-within-60s"
        nearest = min(near, key=lambda x: (x[0], x[1])) if near else None
        result.append({"id": sample.get("id"), "hole": sample.get("actualHole"), "sampleType": sample.get("sampleType"), "status": status, "separateNearbyFixCount": len(separate), "sharedFixCount": len(shared), "nearestTrackId": nearest[2].get("id") if nearest else None, "nearestTimeSeconds": round(nearest[0], 3) if nearest else None, "nearestDistanceMetres": round(nearest[1], 2) if nearest else None, "nearestTrackHole": nearest[2].get("actualHole") if nearest else None})
    return result


def sample_hole_switches(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted([s for s in samples if usable_position(s)], key=lambda s: parse_time(s["timestamp"]))
    result = []
    for a, b in zip(ordered, ordered[1:]):
        dt = (parse_time(b["timestamp"]) - parse_time(a["timestamp"])).total_seconds()
        if a.get("actualHole") == b.get("actualHole") or dt > 60:
            continue
        distance = haversine_m(a["latitude"], a["longitude"], b["latitude"], b["longitude"])
        result.append({"firstId": a.get("id"), "secondId": b.get("id"), "firstHole": a.get("actualHole"), "secondHole": b.get("actualHole"), "timeSeconds": round(dt, 3), "distanceMetres": round(distance, 2), "reason": "fast-hole-label-change-review", "sameFix": dt == 0 and distance < 0.01})
    return result


def cross_round_comparison(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for hole in HOLES:
        for typ in ("tee", "green"):
            groups = [[r for r in records if r["recordKind"] == "sample" and r.get("sampleType") == typ and r.get("actualHole") == hole and r.get("localDate") == date and usable_position(r)] for date in ("2026-10-06", "2026-10-08")]
            pairs = [{"oct6Id": a.get("id"), "oct8Id": b.get("id"), "distanceMetres": round(haversine_m(a["latitude"], a["longitude"], b["latitude"], b["longitude"]), 2)} for a in groups[0] for b in groups[1]]
            distances = [p["distanceMetres"] for p in pairs]
            result.append({"hole": hole, "sampleType": typ, "oct6Count": len(groups[0]), "oct8Count": len(groups[1]), "distancesMetres": percentiles(distances), "pairs": pairs, "status": "missing-one-or-both-days" if not pairs else "mixed-clusters" if min(distances) <= CONFLICT_METRES < max(distances) else "separated" if min(distances) > CONFLICT_METRES else "spatially-compatible"})
    return result


def corridor_diagnostics(records: list[dict[str, Any]], candidates: dict[str, Any]) -> list[dict[str, Any]]:
    corridors = {x["id"]: x for x in candidates.get("topologyCorridors", [])}
    s01 = {x["hole"]: x for x in candidates.get("globalSolutions", [{}])[0].get("entries", [])}
    result = []
    for hole in HOLES:
        samples = [r for r in records if r["recordKind"] == "sample" and r.get("actualHole") == hole and r.get("localDate") == "2026-10-08" and usable_position(r)]
        mappings = {json.dumps(r["candidateMapping"], sort_keys=True): r["candidateMapping"] for r in samples if isinstance(r.get("candidateMapping"), dict) and r["candidateMapping"].get("corridorId")}
        for mapping in mappings.values():
            corridor = corridors.get(mapping["corridorId"])
            if not corridor:
                result.append({"hole": hole, "mapping": mapping, "status": "missing-corridor-reference"})
                continue
            geom = {"geometry": corridor["centerline"]}
            tracks = [r for r in records if r["recordKind"] == "track" and r.get("actualHole") == hole and r.get("localDate") == "2026-10-08" and usable_position(r)]
            track_distances = [geometry_distance_metres(r, geom) for r in tracks]
            nearest_rows = [{"id": r.get("id"), "sampleType": r["sampleType"], "distanceMetres": round(geometry_distance_metres(r, geom), 2)} for r in samples]
            result.append({"hole": hole, "corridorId": corridor["id"], "mapping": mapping, "corridorTeeZoneId": corridor["teeZoneId"], "corridorGreenId": corridor["green"], "teeReferenceConsistent": mapping.get("teeZoneId") == corridor["teeZoneId"], "greenReferenceConsistent": mapping.get("greenId") == corridor["green"], "s01Mapping": {k: s01.get(hole, {}).get(k) for k in ("teeZoneId", "greenId", "corridorId")}, "sampleLineDistances": nearest_rows, "trackLineDistancesMetres": percentiles(track_distances), "tracksWithin30m": sum(d <= 30 for d in track_distances), "trackCount": len(tracks), "note": "Corridor 是估计线，轨迹含跳点；到线距离只作否证与复核，不直接确认打球路线。"})
    return result


def assess_holes(round_by_date: dict[str, dict[str, Any]], candidates: dict[str, Any], cross_round: list[dict[str, Any]] | None = None, corridors: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    existing = {item["hole"]: item for item in candidates.get("holes", [])}
    result: list[dict[str, Any]] = []
    for hole in HOLES:
        old = round_by_date.get("2026-10-06", {}).get("holes", {}).get(hole, {"tee": {"count": 0}, "green": {"count": 0}, "teeCategories": [], "nearestComparisons": []})
        new = round_by_date.get("2026-10-08", {}).get("holes", {}).get(hole, {"tee": {"count": 0}, "green": {"count": 0}, "teeCategories": [], "nearestComparisons": []})
        evidence: list[str] = []
        conflicts: list[str] = []
        if new["tee"]["count"] and new["green"]["count"]:
            evidence.append("10月8日 Tee 与 Green 均有样本")
        elif new["tee"]["count"] or new["green"]["count"]:
            evidence.append("10月8日只有部分采样")
        if old["tee"]["count"] or old["green"]["count"]:
            evidence.append("10月6日有历史样本")
        comparisons = new.get("nearestComparisons", [])
        valid_sample_count = new["tee"]["count"] + new["green"]["count"]
        if len(comparisons) < valid_sample_count:
            conflicts.append("部分10月8日样本缺少有效位置或时间，不能参与空间比较")
        compatible = []
        for comparison in comparisons:
            nearest = comparison.get("nearest", [])
            if not nearest:
                continue
            best = nearest[0]
            review_limit = max(30.0, float(comparison.get("accuracyMetres") or 0.0))
            boundary = best.get("boundaryDistanceMetres")
            if boundary is not None and boundary <= review_limit:
                compatible.append(comparison)
            else:
                conflicts.append(f"10月8日 {comparison.get('sampleType')} 采样未落入最近候选的30米/报告精度复核范围")
        if len(compatible) < len(comparisons) and comparisons:
            evidence.append("部分现场点与候选地物的空间距离需要人工复核")
        mapping_conflicts = [x for x in comparisons if x.get("mappedId") and x.get("nearest") and x["mappedId"] != x["nearest"][0]["id"]]
        if mapping_conflicts:
            evidence.append("记录的 candidateMapping 与现场点最近候选不一致")
        green_spread = (new.get("sampleConsistencyMetres", {}).get("green") or {}).get("max")
        tee_spread = (new.get("sampleConsistencyMetres", {}).get("tee") or {}).get("max")
        if (green_spread is not None and green_spread > CONFLICT_METRES) or (tee_spread is not None and tee_spread > CONFLICT_METRES):
            conflicts.append("同一洞同一类型样本相距超过80米")
        if not new["tee"]["count"] and not new["green"]["count"]:
            status = "plausible" if old["tee"]["count"] and old["green"]["count"] else "insufficient"
        elif conflicts:
            status = "conflicting"
        elif new["tee"]["count"] and new["green"]["count"] and comparisons and len(compatible) == len(comparisons):
            status = "strong-candidate"
        else:
            status = "plausible"
        suggested = {}
        for typ in ("tee", "green"):
            typed = [c for c in comparisons if c["sampleType"] == typ]
            supported = [c["nearest"][0]["id"] for c in typed if c["nearest"] and c["nearest"][0]["boundaryDistanceMetres"] is not None and c["nearest"][0]["boundaryDistanceMetres"] <= max(30, c["accuracyMetres"] or 0)]
            suggested[typ] = supported[0] if typed and len(supported) == len(typed) and len(set(supported)) == 1 else None
        support = [s for s in round_by_date.get("2026-10-08", {}).get("sampleTrackSupport", []) if s.get("hole") == hole]
        gaps = [f"10月8日缺少 {typ} 采样" for typ in ("tee", "green") if not new[typ]["count"]]
        if any(t.get("selectionStatus") != "confirmed" for t in new.get("teeCategories", [])):
            gaps.append("部分T台类别为unknown或inherited，缺少现场明确类别确认")
        if any(x["status"] in {"separated", "mixed-clusters"} for x in (cross_round or []) if x["hole"] == hole):
            gaps.append("跨日同类型位置有分离簇；10月6日操作不确定，需独立证据解释")
        if suggested["tee"] is None and new["tee"]["count"]:
            gaps.append("现有 Tee Zone 不能解释现场位置；需要影像人工数字化或新版地物证据")
        if suggested["green"] is None and new["green"]["count"]:
            gaps.append("Green 候选缺失、距离偏离或同洞样本冲突，不能确定单一地物")
        result.append({"hole": hole, "status": status, "oct6": {"teeCount": old["tee"]["count"], "greenCount": old["green"]["count"], "sampleConsistencyMetres": old.get("sampleConsistencyMetres"), "accuracyMetres": {typ: old[typ].get("accuracyMetres") for typ in ("tee", "green")}}, "oct8": {"teeCount": new["tee"]["count"], "greenCount": new["green"]["count"], "teeCategories": new.get("teeCategories", []), "sampleConsistencyMetres": new.get("sampleConsistencyMetres"), "accuracyMetres": {typ: new[typ].get("accuracyMetres") for typ in ("tee", "green")}}, "legacyProxyCandidate": existing.get(hole, {}).get("bestCandidate"), "nearestComparisons": comparisons, "suggestedReviewObjects": suggested, "crossRound": [x for x in (cross_round or []) if x["hole"] == hole], "corridors": [x for x in (corridors or []) if x["hole"] == hole], "trackSupport": support, "mappingConflictCount": len(mapping_conflicts), "evidence": evidence, "conflicts": conflicts, "evidenceGaps": gaps, "needsManualReview": True, "limitations": ["Green 采样是到达果岭区域的位置，不是果岭中心", "Tee 采样是现场位置，不是发球台几何中心", "候选 score 仅用于排序，不是概率", "2023 影像与2026现场存在时间差且无独立控制点", "轨迹与采样来自同一设备，shared-fix 不构成独立证据"]})
    return result


def build_overlay(records: list[dict[str, Any]], candidates: dict[str, Any], path: Path) -> int:
    # 私有静态 SVG：只供本地复核，不进入 Git。
    bounds = candidates.get("orthophoto", {}).get("wgs84Bounds", {})
    points = [r for r in records if r["recordKind"] == "sample" and r["localDate"] in {"2026-10-06", "2026-10-08"}]
    in_bounds = [r for r in points if bounds and bounds["west"] <= r["longitude"] <= bounds["east"] and bounds["south"] <= r["latitude"] <= bounds["north"]]
    excluded_count = len(points) - len(in_bounds)
    points = in_bounds
    objects = list(candidates.get("teeZones", [])) + list(candidates.get("greenClassifications", []))
    xs = [p["longitude"] for p in points] + [o["center"]["coordinates"][0] for o in objects]
    ys = [p["latitude"] for p in points] + [o["center"]["coordinates"][1] for o in objects]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    pad_x, pad_y = (max_x - min_x) * 0.04, (max_y - min_y) * 0.04
    min_x, max_x, min_y, max_y = min_x - pad_x, max_x + pad_x, min_y - pad_y, max_y + pad_y
    width, height = 1400, 1000
    def xy(lon: float, lat: float) -> tuple[float, float]:
        return ((lon - min_x) / (max_x - min_x) * width, (max_y - lat) / (max_y - min_y) * height)
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">', '<rect width="100%" height="100%" fill="#f7f5ee"/>', '<text x="20" y="30" font-size="22">净山湖 GPS 与空间候选叠加（私有复核图）</text>']
    for obj in objects:
        x, y = xy(*obj["center"]["coordinates"])
        color = "#2563eb" if obj["id"].startswith("TZ") else "#16a34a"
        lines.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}" opacity=".35"/><text x="{x + 5:.1f}" y="{y + 3:.1f}" font-size="8" fill="{color}">{obj["id"]}</text>')
    for point in points:
        x, y = xy(point["longitude"], point["latitude"])
        color = "#dc2626" if point["localDate"] == "2026-10-08" else "#d97706"
        shape = "circle" if point["sampleType"] == "green" else "rect"
        if shape == "circle":
            lines.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{color}" opacity=".78"/>')
        else:
            lines.append(f'<rect x="{x - 4:.1f}" y="{y - 4:.1f}" width="8" height="8" fill="{color}" opacity=".78"/>')
    lines.append('<text x="20" y="970" font-size="14">蓝=候选 Tee Zone；绿=候选 Green；橙=10月6日样本；红=10月8日样本；圆=Green，方=Tee</text></svg>')
    path.write_text("\n".join(lines), encoding="utf-8")
    return excluded_count


def projected_crs_match(left: Any, right: Any) -> bool:
    """忽略 BoundCRS 外壳和轴名差异，仍严格核对基准与投影操作。"""
    from pyproj import CRS

    left_crs, right_crs = CRS.from_user_input(left), CRS.from_user_input(right)
    left_crs = left_crs.source_crs if left_crs.is_bound else left_crs
    right_crs = right_crs.source_crs if right_crs.is_bound else right_crs
    return bool(
        left_crs.is_projected and right_crs.is_projected
        and left_crs.geodetic_crs.equals(right_crs.geodetic_crs, ignore_axis_order=True)
        and left_crs.coordinate_operation == right_crs.coordinate_operation
    )


def inspect_orthophoto(path: Path) -> dict[str, Any]:
    """Inspect the actual GeoTIFF and verify EPSG:4548 -> WGS84 round trips."""
    try:
        import rasterio
        from pyproj import Transformer
    except ImportError as exc:
        return {"available": False, "error": str(exc)}
    with rasterio.open(path) as dataset:
        crs = dataset.crs
        if crs is None or crs.to_epsg() != 4548:
            raise ValueError("本分析要求核验实际 GeoTIFF 为 EPSG:4548，不能默认猜测 CRS")
        transform = dataset.transform
        corners = [(0.5, 0.5), (dataset.width - 0.5, 0.5), (dataset.width - 0.5, dataset.height - 0.5), (0.5, dataset.height - 0.5)]
        source_points = [transform * point for point in corners]
        to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        to_source = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        wgs84_points = [to_wgs84.transform(x, y) for x, y in source_points]
        round_trip_error = max(math.hypot(*(a - b for a, b in zip(point, to_source.transform(*to_wgs84.transform(*point))))) for point in source_points)
        try:
            from scripts.prepare_jingshanhu_orthophoto import find_sidecar, load_world_file, verify_world_file
        except ModuleNotFoundError:
            from prepare_jingshanhu_orthophoto import find_sidecar, load_world_file, verify_world_file
        from pyproj import CRS
        world = find_sidecar(path, (".tfw", ".tifw", ".wld"))
        prj = find_sidecar(path, (".prj",))
        prj_crs = CRS.from_wkt(prj.read_text(encoding="utf-8-sig")) if prj else None
        return {"available": True, "driver": dataset.driver, "width": dataset.width, "height": dataset.height, "bandCount": dataset.count, "crs": crs.to_string(), "epsg": crs.to_epsg(), "transform": list(transform)[:6], "resolutionMetres": [abs(transform.a), abs(transform.e)], "wgs84Corners": [[round(x, 9), round(y, 9)] for x, y in wgs84_points], "roundTripSourceErrorMetres": round(round_trip_error, 9), "bounds": [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top], "worldFileCheck": verify_world_file(transform, load_world_file(world)) if world else None, "prjMatchesRaster": projected_crs_match(crs, prj_crs) if prj_crs else None, "note": "影像为2023年资料；EPSG:4548到WGS84使用always_xy，未进行独立控制点验证。"}


def build_orthophoto_overlay(records: list[dict[str, Any]], candidates: dict[str, Any], orthophoto: Path, output: Path) -> dict[str, Any]:
    """私有检查图：两轮、候选边界、编号、轨迹散点和 Corridor 分层展示。"""
    try:
        import rasterio
        from PIL import Image, ImageDraw, ImageFont
        from pyproj import Transformer
    except ImportError as exc:
        return {"available": False, "error": str(exc)}
    with rasterio.open(orthophoto) as dataset:
        max_dim = 3000
        scale = min(1.0, max_dim / max(dataset.width, dataset.height))
        out_width, out_height = max(1, int(dataset.width * scale)), max(1, int(dataset.height * scale))
        bands = dataset.read([1, 2, 3], out_shape=(3, out_height, out_width), masked=True)
        rgb = bands.filled(255).transpose(1, 2, 0).astype("uint8")
        image = Image.fromarray(rgb)
        draw = ImageDraw.Draw(image, "RGBA")
        to_source = Transformer.from_crs("EPSG:4326", dataset.crs, always_xy=True)
        font_path = Path("C:/Windows/Fonts/msyh.ttc")
        font = ImageFont.truetype(str(font_path), 16) if font_path.exists() else ImageFont.load_default()
        def pixel(lon: float, lat: float) -> tuple[float, float]:
            x, y = to_source.transform(lon, lat, errcheck=True)
            col, row = (~dataset.transform) * (x, y)
            return col * out_width / dataset.width, row * out_height / dataset.height
        for obj in list(candidates.get("teeZones", [])) + list(candidates.get("greenClassifications", [])):
            color = (37, 99, 235, 200) if obj["id"].startswith("TZ") else (22, 163, 74, 200)
            for ring in obj.get("geometry", {}).get("coordinates", []):
                draw.line([pixel(*p) for p in ring], fill=color, width=2)
            px, py = pixel(*obj["center"]["coordinates"])
            draw.text((px + 5, py + 4), obj["id"], fill=color, font=font, stroke_width=1, stroke_fill="white")
        corridor_image = image.copy()
        corridor_draw = ImageDraw.Draw(corridor_image, "RGBA")
        active_corridors = {r.get("candidateMapping", {}).get("corridorId") for r in records if r.get("recordKind") == "sample" and isinstance(r.get("candidateMapping"), dict)}
        for corridor in candidates.get("topologyCorridors", []):
            if corridor["id"] in active_corridors:
                line = [pixel(*p) for p in corridor["centerline"]["coordinates"]]
                corridor_draw.line(line, fill=(70, 60, 200, 180), width=3)
                corridor_draw.text(line[len(line)//2], corridor["id"], fill="white", font=font, stroke_width=2, stroke_fill=(70, 60, 200))
        track_image = image.copy()
        track_draw = ImageDraw.Draw(track_image, "RGBA")
        for record in records:
            if record.get("recordKind") == "track" and record.get("localDate") in {"2026-10-06", "2026-10-08"} and usable_position(record):
                px, py = pixel(record["longitude"], record["latitude"])
                color = (240, 170, 20, 160) if record["localDate"] == "2026-10-06" else (170, 20, 220, 160)
                # 不连接异常跳点、空档，也不把点顺序伪装成连续打球路线。
                track_draw.ellipse((px-3, py-3, px+3, py+3), fill=color)
        in_bounds = 0
        positions: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for record in records:
            if record.get("recordKind") != "sample" or record.get("localDate") not in {"2026-10-06", "2026-10-08"} or not usable_position(record):
                continue
            px, py = pixel(record["longitude"], record["latitude"])
            if 0 <= px < out_width and 0 <= py < out_height:
                in_bounds += 1
                positions[record.get("actualHole")].append((px, py))
                color = (217, 119, 6, 220) if record["localDate"] == "2026-10-06" else (220, 38, 38, 220)
                for painter in (draw, corridor_draw, track_draw):
                    if record.get("sampleType") == "tee":
                        painter.rectangle((px - 5, py - 5, px + 5, py + 5), fill=color, outline="white")
                    else:
                        painter.ellipse((px - 5, py - 5, px + 5, py + 5), fill=color, outline="white")
                    label = f"H{record.get('actualHole')}{'T' if record['sampleType']=='tee' else 'G'}"
                    painter.text((px+8, py-18), label, font=font, fill=color, stroke_width=1, stroke_fill="white")
        for painter, legend in ((draw, "2023影像 | 橙=10/6 红=10/8 | 圆=Green 方=Tee | 蓝/绿=候选边界"), (corridor_draw, "私有 Corridor 检查 | 紫=现有映射路线（估计）| 不是实际打球路线"), (track_draw, "私有轨迹散点 | 黄=10/6 紫=10/8 | 跳点和空档未连接 | 同设备证据")):
            painter.rectangle((8, 8, 850, 44), fill=(255, 255, 255, 225))
            painter.text((16, 14), legend, font=font, fill="black")
        image.save(output, format="PNG", optimize=True)
        corridor_image.save(output.parent / "corridor_overlay.png")
        track_image.save(output.parent / "track_overlay.png")
        sheet = Image.new("RGB", (4*480, 5*380), "#eee")
        sheet_draw = ImageDraw.Draw(sheet)
        for index, hole in enumerate(HOLES):
            coords = positions.get(hole, [])
            offset = ((index%4)*480, (index//4)*380)
            if coords:
                box = (max(0, int(min(p[0] for p in coords)-70)), max(0, int(min(p[1] for p in coords)-70)), min(out_width, int(max(p[0] for p in coords)+70)), min(out_height, int(max(p[1] for p in coords)+70)))
                crop = image.crop(box)
                crop.save(output.parent / f"hole_{hole:02d}_overlay.png")
                crop.thumbnail((470, 345))
                sheet.paste(crop, (offset[0]+5, offset[1]+30))
            sheet_draw.text((offset[0]+10, offset[1]+5), f"H{hole}: 两日采样对照" if coords else f"H{hole}: 无采样，不推测位置", font=font, fill="black")
        sheet.save(output.parent / "hole_contact_sheet.png")
        return {"available": True, "path": str(output), "width": out_width, "height": out_height, "samplePointsInRaster": in_bounds, "samplePointsTotal": sum(1 for r in records if r.get("recordKind") == "sample" and r.get("localDate") in {"2026-10-06", "2026-10-08"}), "note": "静态私有复核图；不是测量成果或地物确认。"}


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("\n", encoding="utf-8")
        return
    keys = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys)
        writer.writeheader()
        writer.writerows({key: row.get(key) for key in keys} for row in rows)


def write_json(path: Path, value: Any) -> None:
    """Write a private result atomically so an interrupted run cannot leave JSON half-written."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def verify_private_output(output: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    private_root = (root / "field-tests/private").resolve()
    try:
        output.resolve().relative_to(private_root)
    except ValueError as exc:
        raise ValueError("含 GPS 的输出必须位于本仓库 field-tests/private/ 内") from exc
    relative = output.resolve().relative_to(root).as_posix()
    ignored = subprocess.run(["git", "-C", str(root), "check-ignore", "--quiet", "--no-index", "--", relative], capture_output=True)
    if ignored.returncode != 0:
        raise ValueError("输出目录没有通过 git check-ignore，停止写入私人 GPS")


def analyse(inputs: list[Path], candidates_path: Path, metadata_path: Path, output: Path, orthophoto_path: Path | None = None) -> dict[str, Any]:
    if not inputs:
        raise ValueError("必须提供真实输入文件")
    verify_private_output(output)
    if any(output.resolve() == p.resolve().parent for p in inputs):
        raise ValueError("输出目录不得与原件所在目录相同")
    records, issues, exports = flatten_exports(inputs)
    deduped, duplicate_ids = dedupe_records(records)
    near_duplicates = find_near_duplicates(deduped)
    candidates = read_json(candidates_path)
    if "4326" not in candidates.get("coordinateSystem", ""):
        raise ValueError("候选数据必须显式使用 EPSG:4326 / WGS84")
    metadata = read_json(metadata_path)
    tees, greens = candidate_lookup(candidates)
    rounds: dict[str, dict[str, Any]] = {}
    for date in ("2026-10-06", "2026-10-08"):
        stats, _ = round_stats([r for r in deduped if r["localDate"] == date], tees, greens)
        rounds[date] = stats
    cross_round = cross_round_comparison(deduped)
    corridor_rows = corridor_diagnostics(deduped, candidates)
    assessments = assess_holes(rounds, candidates, cross_round, corridor_rows)
    mapping_rows = []
    for record in deduped:
        if record["recordKind"] != "sample" or record["localDate"] != "2026-10-08" or not usable_position(record):
            continue
        objects = tees if record.get("sampleType") == "tee" else greens
        nearest = spatial_evidence(record, list(objects.values()))
        mapping = record.get("candidateMapping") or {}
        mapped_id = mapping.get("teeZoneId") if record.get("sampleType") == "tee" else mapping.get("greenId")
        mapped = next((x for x in nearest if x["id"] == mapped_id), None)
        mapping_rows.append({"id": record["id"], "hole": record.get("actualHole"), "sampleType": record.get("sampleType"), "mappedId": mapped_id, "nearestId": nearest[0]["id"] if nearest else None, "mappedCenterDistanceMetres": mapped["centerDistanceMetres"] if mapped else None, "mappedBoundaryDistanceMetres": mapped["boundaryDistanceMetres"] if mapped else None, "nearestBoundaryDistanceMetres": nearest[0].get("boundaryDistanceMetres") if nearest else None, "comparisonStatus": "missing-mapping" if not mapped_id else "unknown-mapping-id" if not mapped else "nearest-match" if nearest and mapped_id == nearest[0]["id"] else "nearest-mismatch", "matchesNearest": bool(nearest and mapped_id == nearest[0]["id"])})
    session_ids = {doc.get("session", {}).get("sessionId") for doc in exports.values()}
    source_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    old_samples = {r.get("id") for r in records if r["sourceFile"] == inputs[0].name and r["recordKind"] == "sample"}
    new_samples = {r.get("id") for r in records if r["sourceFile"] == inputs[-1].name and r["recordKind"] == "sample"}
    summary = {"schemaVersion": 1, "analysisTimezone": "Asia/Shanghai", "inputFiles": [p.name for p in inputs], "inputFileSha256": source_hashes, "inputFileSessionIds": {name: doc.get("session", {}).get("sessionId") for name, doc in exports.items()}, "sessionIdConflict": len(session_ids) > 1, "sameSessionAcrossExports": len(session_ids) == 1, "versionRelationship": {"oldSampleCount": len(old_samples), "newSampleCount": len(new_samples), "oldSampleIdsInNew": len(old_samples & new_samples), "oldSampleIdsOnly": len(old_samples - new_samples), "newSampleIdsOnly": len(new_samples - old_samples)}, "sourceRecordCounts": {p.name: {"samples": len(exports[p.name].get("samples", [])), "track": len(exports[p.name].get("track", [])), "confirmationEvents": len(exports[p.name].get("confirmationEvents", [])), "exportedAt": exports[p.name].get("metadata", {}).get("exportedAt")} for p in inputs}, "rawRecordCount": len(records), "dedupedRecordCount": len(deduped), "duplicateIdCount": len(duplicate_ids), "nearDuplicateCount": len(near_duplicates), "rounds": {date: {key: value for key, value in stats.items() if key != "holes"} for date, stats in rounds.items()}, "mappingComparisonOct8": {"sampleCount": len(mapping_rows), "matchesNearestCount": sum(1 for x in mapping_rows if x["matchesNearest"]), "mismatchCount": sum(1 for x in mapping_rows if not x["matchesNearest"])}, "validationIssues": issues, "spatialValidation": {"candidateCoordinateSystem": candidates.get("coordinateSystem"), "candidateSourceCrs": candidates.get("sourceCrs"), "orthophotoMetadata": str(metadata_path), "orthophotoCheck": {"available": False, "error": "尚未检查"}}}
    summary["mappingComparisonOct8"] = {"sampleCount": len(mapping_rows), "comparisonCounts": dict(Counter(x["comparisonStatus"] for x in mapping_rows)), "mappedHoleCount": len({x["hole"] for x in mapping_rows if x["mappedId"]}), "corridorReferenceConflictHoles": [x["hole"] for x in corridor_rows if not x.get("teeReferenceConsistent", True) or not x.get("greenReferenceConsistent", True)]}
    summary["invalidRecordCount"] = sum(bool(x.get("invalidReasons")) for x in deduped)
    summary["duplicateContentConflictCount"] = sum(x["reason"] == "duplicate-id-content-conflict" for x in duplicate_ids)
    summary["analysisParameters"] = {"roundDates": ["2026-10-06", "2026-10-08"], "nearDuplicateSeconds": NEAR_DUP_SECONDS, "nearDuplicateMetres": NEAR_DUP_METRES, "sameTypeSpreadReviewMetres": CONFLICT_METRES, "trackJumpSpeedMps": JUMP_SPEED_MPS, "trackSupportSeconds": 60, "trackSupportMetres": 30, "candidateReviewMetres": "max(30, reported accuracy); screening only, not validated error"}
    summary["qualityStatusCounts"] = dict(Counter(x["status"] for x in assessments))
    try:
        photo_check = inspect_orthophoto(orthophoto_path) if orthophoto_path else {"available": False, "error": "未提供本地影像"}
    except (OSError, ValueError, ImportError) as exc:
        photo_check = {"available": False, "error": str(exc)}
    raster_metadata = metadata.get("raster", {})
    photo_check["matchesSavedMetadata"] = photo_check.get("available", False) and photo_check.get("width") == raster_metadata.get("width") and photo_check.get("height") == raster_metadata.get("height") and photo_check.get("transform") == raster_metadata.get("affineTransform")
    summary["spatialValidation"]["orthophotoCheck"] = photo_check
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "deduped_records.json", deduped)
    for date, stats in rounds.items():
        subset = [r for r in deduped if r["localDate"] == date]
        write_json(output / f"round_{date}.json", {"date": date, "records": subset, "stats": stats})
    non_round = [r for r in deduped if r.get("localDate") not in {"2026-10-06", "2026-10-08"}]
    write_json(output / "non_round_records.json", non_round)
    write_json(output / "version_comparison.json", summary["versionRelationship"])
    write_json(output / "cross_round_comparison.json", cross_round)
    write_json(output / "corridor_diagnostics.json", corridor_rows)
    write_json(output / "hole_assessment.json", assessments)
    write_json(output / "anomalies.json", {"duplicateIds": duplicate_ids, "nearDuplicates": near_duplicates, "mappingOct8": mapping_rows, "speedAnomalies": {date: rounds[date]["speedAnomalies"] for date in rounds}, "trackJumpAnomalies": {date: rounds[date]["trackJumpAnomalies"] for date in rounds}, "sameTimestampPositionConflicts": {date: rounds[date]["sameTimestampPositionConflicts"] for date in rounds}, "trackGaps": {date: rounds[date]["trackGaps"] for date in rounds}, "holeSwitches": {date: rounds[date]["holeSwitches"] for date in rounds}})
    write_csv(output / "hole_assessment.csv", assessments)
    write_csv(output / "mapping_oct8.csv", mapping_rows)
    write_json(output / "quality_diagnostics.json", {"invalidRecords": [r for r in deduped if r.get("invalidReasons")], "sampleTrackSupport": {d: rounds[d]["sampleTrackSupport"] for d in rounds}, "sampleHoleSwitchFlags": {d: rounds[d]["sampleHoleSwitchFlags"] for d in rounds}})
    excluded = build_overlay(deduped, candidates, output / "overlay.svg")
    if orthophoto_path and photo_check.get("available"):
        summary["spatialValidation"]["overlay"] = build_orthophoto_overlay(deduped, candidates, orthophoto_path, output / "orthophoto_overlay.png")
    summary["spatialValidation"]["svgSamplesExcludedOutsideBounds"] = excluded
    write_json(output / "summary.json", summary)
    write_json(output / "source_manifest.json", {"inputs": [{"file": p.name, "sha256": source_hashes[p.name], "sessionId": exports[p.name].get("session", {}).get("sessionId"), "samples": len(exports[p.name].get("samples", [])), "track": len(exports[p.name].get("track", []))} for p in inputs], "derivedOutputIsPrivate": True})
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", nargs="+", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, default=Path("data/derived/jingshanhu/spatial-candidates.json"))
    parser.add_argument("--orthophoto-metadata", type=Path, default=Path("data/derived/jingshanhu/orthophoto_2023_metadata.json"))
    parser.add_argument("--orthophoto", type=Path, default=Path("data/raw/jingshanhu_orthophoto_2023/净山湖高尔夫球场2023/净山湖高尔夫球场2023.tif"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        summary = analyse(args.input, args.candidates, args.orthophoto_metadata, args.output, args.orthophoto if args.orthophoto.exists() else None)
    except (OSError, ValueError, ImportError) as exc:
        parser.exit(2, f"05A 分析失败：{exc}\n")
    safe = {key: summary[key] for key in ("rawRecordCount", "dedupedRecordCount", "duplicateIdCount", "nearDuplicateCount", "mappingComparisonOct8", "qualityStatusCounts")}
    safe["rounds"] = {d: {k: v for k, v in r.items() if k in {"sampleCount", "teeCount", "greenCount", "trackCount", "coveredHoles", "completeTeeGreenHoles", "accuracyMetres"}} for d, r in summary["rounds"].items()}
    print(json.dumps(safe, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build conservative spatial candidates from Jingshanhu OSM reference data.

This script deliberately does not assign OSM objects to numbered holes.  The
Overpass extract contains spatial features (green/tee/obstacle) but no hole
references.  Tee-to-green straight lines are therefore exported as length
comparison proxies, never as course centerlines.

The output is a small, reviewable JSON file.  It contains WGS84 GeoJSON-like
geometries and the corresponding continuous image-pixel geometry.  Running
the script again with the same input files produces the same IDs and order.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable, Sequence

from pyproj import CRS, Transformer


WGS84 = CRS.from_epsg(4326)
METRES_PER_YARD = 0.9144
EARTH_RADIUS_METRES = 6_371_008.8

OSM_URL = "https://overpass-api.de/api/interpreter"
OSM_LICENSE = "OpenStreetMap contributors, ODbL"

# Keep these broad.  They are only sanity priors for the displayed explanation,
# not a hole classifier.  A direct tee-green line can be much shorter than a
# playing yardage on a dogleg.
PAR_DIRECT_METRE_RANGES: dict[int, tuple[float, float]] = {
    3: (70.0, 320.0),
    4: (160.0, 620.0),
    5: (280.0, 850.0),
}

KIND_CONFIG: dict[str, tuple[str, str, str]] = {
    "green": ("green", "G", "Polygon"),
    "tee": ("tee", "T", "Polygon"),
    "bunker": ("bunker", "B", "Polygon"),
    "water_hazard": ("water", "W", "Polygon"),
    "cartpath": ("cartpath", "P", "LineString"),
    "rough": ("rough", "R", "Polygon"),
}


def round_number(value: float, digits: int = 8) -> float:
    """Make generated JSON stable and readable without losing useful precision."""
    return float(round(float(value), digits))


def rounded_position(position: Sequence[float], digits: int = 8) -> list[float]:
    return [round_number(float(position[0]), digits), round_number(float(position[1]), digits)]


def haversine_metres(left: Sequence[float], right: Sequence[float]) -> float:
    lon1, lat1 = math.radians(float(left[0])), math.radians(float(left[1]))
    lon2, lat2 = math.radians(float(right[0])), math.radians(float(right[1]))
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_METRES * 2 * math.asin(min(1.0, math.sqrt(a)))


def polygon_centroid(ring: Sequence[Sequence[float]]) -> tuple[float, float]:
    """Return a planar centroid in the very small local WGS84 area."""
    points = [(float(point[0]), float(point[1])) for point in ring]
    if len(points) >= 2 and points[0] != points[-1]:
        points.append(points[0])
    if len(points) < 4:
        return (
            sum(point[0] for point in points) / max(len(points), 1),
            sum(point[1] for point in points) / max(len(points), 1),
        )
    # Translate before the shoelace calculation.  Using longitude values near
    # 116 directly loses enough precision to put a small polygon's centroid
    # outside its own bounds.
    origin_x = sum(point[0] for point in points[:-1]) / max(len(points) - 1, 1)
    origin_y = sum(point[1] for point in points[:-1]) / max(len(points) - 1, 1)
    local_points = [(point[0] - origin_x, point[1] - origin_y) for point in points]
    area_twice = 0.0
    centroid_x = 0.0
    centroid_y = 0.0
    for first, second in zip(local_points, local_points[1:]):
        cross = first[0] * second[1] - second[0] * first[1]
        area_twice += cross
        centroid_x += (first[0] + second[0]) * cross
        centroid_y += (first[1] + second[1]) * cross
    if abs(area_twice) <= 1e-15:
        open_points = points[:-1]
        return (
            sum(point[0] for point in open_points) / max(len(open_points), 1),
            sum(point[1] for point in open_points) / max(len(open_points), 1),
        )
    return origin_x + centroid_x / (3.0 * area_twice), origin_y + centroid_y / (3.0 * area_twice)


def as_closed_ring(points: Iterable[Sequence[float]]) -> list[list[float]]:
    ring = [rounded_position(point) for point in points]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0].copy())
    return ring


def geometry_from_osm(element: dict[str, Any], kind: str) -> dict[str, Any]:
    source_points = [[float(point["lon"]), float(point["lat"])] for point in element.get("geometry", [])]
    if kind == "cartpath":
        return {"type": "LineString", "coordinates": [rounded_position(point) for point in source_points]}
    return {"type": "Polygon", "coordinates": [as_closed_ring(source_points)]}


def geometry_coordinates(geometry: dict[str, Any]) -> list[list[float]]:
    if geometry["type"] == "LineString":
        return list(geometry["coordinates"])
    return [position for ring in geometry["coordinates"] for position in ring]


def geometry_center(geometry: dict[str, Any]) -> tuple[float, float]:
    if geometry["type"] == "Polygon":
        return polygon_centroid(geometry["coordinates"][0])
    coordinates = geometry["coordinates"]
    if not coordinates:
        raise ValueError("Cannot calculate a center for empty geometry")
    return (
        sum(float(point[0]) for point in coordinates) / len(coordinates),
        sum(float(point[1]) for point in coordinates) / len(coordinates),
    )


def geometry_to_pixels(
    geometry: dict[str, Any],
    to_source: Transformer,
    affine: Sequence[float],
) -> dict[str, Any]:
    """Transform WGS84 coordinates through source CRS and inverse affine."""
    a, b, c, d, e, f = [float(value) for value in affine[:6]]
    determinant = a * e - b * d
    if abs(determinant) <= 1e-15:
        raise ValueError("Orthophoto affine transform is not invertible")

    def to_pixel(position: Sequence[float]) -> list[float]:
        source_x, source_y = to_source.transform(float(position[0]), float(position[1]), errcheck=True)
        delta_x = source_x - c
        delta_y = source_y - f
        column = (delta_x * e - b * delta_y) / determinant
        row = (a * delta_y - d * delta_x) / determinant
        return [round_number(column, 3), round_number(row, 3)]

    if geometry["type"] == "LineString":
        return {"type": "LineString", "coordinates": [to_pixel(point) for point in geometry["coordinates"]]}
    return {"type": "Polygon", "coordinates": [[to_pixel(point) for point in ring] for ring in geometry["coordinates"]]}


def bounds_of_geometry(geometry: dict[str, Any]) -> dict[str, float]:
    coordinates = geometry_coordinates(geometry)
    longitudes = [float(point[0]) for point in coordinates]
    latitudes = [float(point[1]) for point in coordinates]
    return {
        "west": round_number(min(longitudes)),
        "south": round_number(min(latitudes)),
        "east": round_number(max(longitudes)),
        "north": round_number(max(latitudes)),
    }


def pixel_bounds_of_geometry(geometry: dict[str, Any]) -> dict[str, float]:
    coordinates = geometry_coordinates(geometry)
    columns = [float(point[0]) for point in coordinates]
    rows = [float(point[1]) for point in coordinates]
    return {
        "minColumn": round_number(min(columns), 3),
        "minRow": round_number(min(rows), 3),
        "maxColumn": round_number(max(columns), 3),
        "maxRow": round_number(max(rows), 3),
    }


def point_within_bounds(point: Sequence[float], bounds: dict[str, float]) -> bool:
    return bounds["west"] <= point[0] <= bounds["east"] and bounds["south"] <= point[1] <= bounds["north"]


def load_metadata(path: Path) -> tuple[dict[str, Any], Transformer, Transformer]:
    metadata = json.loads(path.read_text(encoding="utf-8"))
    raster = metadata["raster"]
    source_crs = CRS.from_epsg(int(raster["sourceCrs"]["epsg"]))
    to_wgs84 = Transformer.from_crs(source_crs, WGS84, always_xy=True)
    from_wgs84 = Transformer.from_crs(WGS84, source_crs, always_xy=True)
    return metadata, to_wgs84, from_wgs84


def load_osm(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    elements = document.get("elements")
    if not isinstance(elements, list):
        raise ValueError("OSM extract must contain an elements array")
    selected = []
    for element in elements:
        if element.get("type") != "way":
            continue
        tags = element.get("tags", {})
        kind = tags.get("golf")
        if kind not in KIND_CONFIG:
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list) or len(geometry) < 2:
            continue
        selected.append(element)
    return selected


def build_spatial_objects(
    elements: list[dict[str, Any]],
    to_source: Transformer,
    affine: Sequence[float],
    image_bounds: dict[str, float],
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {kind: [] for kind in KIND_CONFIG}
    for element in elements:
        kind = element["tags"]["golf"]
        geometry = geometry_from_osm(element, kind)
        if kind == "cartpath" and len(geometry["coordinates"]) < 2:
            continue
        if kind != "cartpath" and len(geometry["coordinates"][0]) < 4:
            continue
        center = geometry_center(geometry)
        grouped[kind].append({"element": element, "geometry": geometry, "center": center})

    objects: list[dict[str, Any]] = []
    for kind, (display_kind, prefix, _) in KIND_CONFIG.items():
        entries = sorted(grouped[kind], key=lambda entry: (entry["center"][1], entry["center"][0], int(entry["element"]["id"])))
        for index, entry in enumerate(entries, start=1):
            object_id = f"{prefix}{index:02d}"
            geometry = entry["geometry"]
            center = rounded_position(entry["center"])
            pixel_geometry = geometry_to_pixels(geometry, to_source, affine)
            pixel_center = geometry_to_pixels({"type": "LineString", "coordinates": [center, center]}, to_source, affine)["coordinates"][0]
            in_bounds = point_within_bounds(center, image_bounds)
            objects.append({
                "id": object_id,
                "kind": display_kind,
                "sourceType": "osm-way",
                "osmWayId": int(entry["element"]["id"]),
                "osmTags": entry["element"].get("tags", {}),
                "geometry": geometry,
                "center": {"type": "Point", "coordinates": center},
                "imagePixels": {
                    "geometry": pixel_geometry,
                    "center": pixel_center,
                    "bounds": pixel_bounds_of_geometry(pixel_geometry),
                },
                "wgs84Bounds": bounds_of_geometry(geometry),
                "inOrthophotoBounds": in_bounds,
                "estimated": False,
                "digitization": "imported",
                "provenance": {
                    "source": "OpenStreetMap Overpass extract",
                    "sourceFile": "data/raw/osm-jingshanhu-golf.json",
                    "sourceUrl": OSM_URL,
                    "license": OSM_LICENSE,
                    "coordinateSystem": "EPSG:4326 / WGS84 (OSM geometry)",
                },
            })
    return objects


def objects_by_kind(objects: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [obj for obj in objects if obj["kind"] == kind]


def object_center(obj: dict[str, Any]) -> list[float]:
    return list(obj["center"]["coordinates"])


def nearest_water_and_bunkers(
    line_start: Sequence[float],
    line_end: Sequence[float],
    obstacles: list[dict[str, Any]],
    threshold_metres: float = 75.0,
) -> tuple[list[str], list[str]]:
    """Report nearby obstacle centers as weak, review-only context.

    This intentionally does not test polygon intersection.  A straight proxy is
    not a fairway, so proximity is descriptive and never boosts a candidate to a
    verified status.
    """
    nearby_water: list[str] = []
    nearby_bunkers: list[str] = []
    for obstacle in obstacles:
        center = object_center(obstacle)
        distance = min(haversine_metres(center, line_start), haversine_metres(center, line_end))
        if distance > threshold_metres:
            continue
        if obstacle["kind"] == "water":
            nearby_water.append(obstacle["id"])
        elif obstacle["kind"] == "bunker":
            nearby_bunkers.append(obstacle["id"])
    return nearby_water, nearby_bunkers


def target_distance_match(
    line_length: float,
    tee_yardages: dict[str, Any],
) -> tuple[str, int, float, float]:
    yardages = [(name, int(value), int(value) * METRES_PER_YARD) for name, value in tee_yardages.items()]
    variant, yardage, target_metres = min(yardages, key=lambda row: abs(line_length - row[2]))
    relative_error = abs(line_length - target_metres) / max(target_metres, 1.0)
    # A broad, monotonic score keeps the ranking explainable.  It does not claim
    # that direct distance is playing length.
    score = max(0.0, min(1.0, 1.0 - relative_error / 0.65))
    return variant, yardage, target_metres, score


def candidate_score(
    line_length: float,
    hole: dict[str, Any],
    nearby_water: list[str],
    nearby_bunkers: list[str],
) -> tuple[float, dict[str, Any]]:
    variant, yardage, target_metres, length_score = target_distance_match(line_length, hole["teeYardages"])
    par = int(hole["par"])
    range_min, range_max = PAR_DIRECT_METRE_RANGES[par]
    par_score = 1.0 if range_min <= line_length <= range_max else 0.35
    # Keep the ranking score below a high-confidence interpretation.  The
    # spread remains visible for review; no amount of length agreement can
    # overcome the missing numbered spatial evidence.
    score = min(0.68, 0.60 * length_score + 0.08 * par_score)
    relative_error = abs(line_length - target_metres) / max(target_metres, 1.0)
    evidence = [
        f"长度比较 proxy：Tee→Green 直线约 {line_length:.0f} m；最接近 {variant} {yardage} yd（{target_metres:.0f} m），相对差 {relative_error:.0%}。",
        f"Par {par} 的宽范围直线先验{'匹配' if par_score == 1.0 else '不匹配'}；仅用于排序，不能证明洞号。",
    ]
    if nearby_water:
        evidence.append(f"proxy 端点 75 m 内有水体对象 {', '.join(nearby_water)}（仅作空间复查提示）。")
    if nearby_bunkers:
        evidence.append(f"proxy 端点 75 m 内有沙坑对象 {', '.join(nearby_bunkers)}（仅作空间复查提示）。")
    conflicts = [
        "OSM Green/Tee 没有 Hole/ref 编号，不能由此独立确认该洞。",
        "直线长度不等于实际击球路线；dogleg 和 Tee 选择可能造成明显差异。",
    ]
    if line_length < target_metres * 0.35:
        conflicts.append("直线显著短于公开码数；可能是 dogleg，也可能是错误对象组合。")
    return score, {
        "matchedTeeVariant": variant,
        "matchedYardage": yardage,
        "targetMetres": round_number(target_metres, 2),
        "lineLengthMetres": round_number(line_length, 2),
        "relativeLengthError": round_number(relative_error, 4),
        "evidence": evidence,
        "conflicts": conflicts,
    }


def build_corridors(
    tees: list[dict[str, Any]],
    greens: list[dict[str, Any]],
    obstacles: list[dict[str, Any]],
    to_source: Transformer,
    affine: Sequence[float],
) -> list[dict[str, Any]]:
    pairs = []
    for tee in tees:
        for green in greens:
            start = object_center(tee)
            end = object_center(green)
            geometry = {"type": "LineString", "coordinates": [rounded_position(start), rounded_position(end)]}
            pixel_geometry = geometry_to_pixels(geometry, to_source, affine)
            nearby_water, nearby_bunkers = nearest_water_and_bunkers(start, end, obstacles)
            pairs.append({
                "tee": tee,
                "green": green,
                "geometry": geometry,
                "pixelGeometry": pixel_geometry,
                "lengthMetres": haversine_metres(start, end),
                "nearbyWater": nearby_water,
                "nearbyBunkers": nearby_bunkers,
            })
    pairs.sort(key=lambda pair: (pair["tee"]["id"], pair["green"]["id"]))
    corridors = []
    for index, pair in enumerate(pairs, start=1):
        corridor_id = f"C{index:02d}"
        corridors.append({
            "id": corridor_id,
            "kind": "hole-corridor-proxy",
            "tee": pair["tee"]["id"],
            "green": pair["green"]["id"],
            "geometry": pair["geometry"],
            "imagePixels": {
                "geometry": pair["pixelGeometry"],
                "bounds": pixel_bounds_of_geometry(pair["pixelGeometry"]),
            },
            "lengthMetres": round_number(pair["lengthMetres"], 2),
            "nearbyWater": pair["nearbyWater"],
            "nearbyBunkers": pair["nearbyBunkers"],
            "geometryRole": "straight-line tee-green length comparison proxy",
            "centerline": False,
            "estimated": True,
            "provenance": {
                "source": "Derived from two imported OSM spatial objects",
                "sourceFile": "data/raw/osm-jingshanhu-golf.json",
                "coordinateSystem": "EPSG:4326 / WGS84",
                "method": "Connect object centroids; no numbered-hole evidence",
            },
        })
    return corridors


def build_hole_candidates(
    course: dict[str, Any],
    tees: list[dict[str, Any]],
    greens: list[dict[str, Any]],
    corridors: list[dict[str, Any]],
    obstacles: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    corridor_by_pair = {(corridor["tee"], corridor["green"]): corridor for corridor in corridors}
    holes: list[dict[str, Any]] = []
    for feature in sorted(course.get("features", []), key=lambda item: int(item["properties"]["hole"])):
        properties = feature["properties"]
        hole = int(properties["hole"])
        candidates = []
        for tee in tees:
            for green in greens:
                corridor = corridor_by_pair[(tee["id"], green["id"])]
                score, explanation = candidate_score(
                    float(corridor["lengthMetres"]),
                    properties,
                    corridor["nearbyWater"],
                    corridor["nearbyBunkers"],
                )
                candidates.append({
                    "tee": tee["id"],
                    "green": green["id"],
                    "corridor": corridor["id"],
                    "score": round_number(score, 4),
                    **explanation,
                })
        candidates.sort(key=lambda item: (-item["score"], item["tee"], item["green"], item["corridor"]))
        best = candidates[0] if candidates else None
        status = "candidate" if best is not None and best["score"] >= 0.35 else "unknown"
        evidence = best["evidence"] if best else ["没有可用的 Tee/Green 空间对象，无法形成长度比较候选。"]
        conflicts = best["conflicts"] if best else ["没有可用候选。"]
        holes.append({
            "hole": hole,
            "par": properties.get("par"),
            "teeYardages": properties.get("teeYardages", {}),
            "status": status,
            "bestCandidate": best,
            "alternatives": candidates[1:5],
            "evidence": evidence,
            "conflicts": conflicts,
            "fieldConfirmed": False,
            "mappingIndependentEvidence": False,
            "spatialVerified": False,
            "spatialEstimated": best is not None,
            "limitations": [
                "当前输入没有带 Hole/ref 的独立空间证据；候选只用于复查和现场确认准备。",
                "候选 Tee/Green ID 是空间对象 ID，不是洞号。",
                "corridor 是 Tee→Green 直线 proxy，不是实际球道 centerline。",
            ],
            "provenance": {
                "holeParDistance": "data/derived/jingshanhu/course.geojson",
                "spatialObjects": "OpenStreetMap Overpass extract (ODbL)",
                "candidateMethod": "scripts/build_jingshanhu_spatial_candidates.py",
            },
        })
    return holes


def build_transitions(holes: list[dict[str, Any]], corridor_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    transitions: list[dict[str, Any]] = []
    for current, following in zip(holes, holes[1:]):
        current_best = current.get("bestCandidate")
        following_best = following.get("bestCandidate")
        record: dict[str, Any] = {
            "fromHole": current["hole"],
            "toHole": following["hole"],
            "usedForScoring": False,
            "routeOptimization": False,
            "interpretation": "仅报告候选 Green→下一候选 Tee 的空间关系；没有用于强制编号或唯一化。",
        }
        if current_best and following_best:
            from_corridor = corridor_by_id[current_best["corridor"]]
            to_corridor = corridor_by_id[following_best["corridor"]]
            from_green = next(point for point in from_corridor["geometry"]["coordinates"][1:])
            to_tee = to_corridor["geometry"]["coordinates"][0]
            record.update({
                "fromCorridor": current_best["corridor"],
                "toCorridor": following_best["corridor"],
                "fromGreen": current_best["green"],
                "toTee": following_best["tee"],
                "straightTransitionMetres": round_number(haversine_metres(from_green, to_tee), 2),
            })
        else:
            record["conflict"] = "相邻洞至少一侧没有候选，无法计算转场。"
        transitions.append(record)
    return transitions


def build_candidates(
    osm_path: Path,
    course_path: Path,
    metadata_path: Path,
) -> dict[str, Any]:
    metadata, _, from_wgs84 = load_metadata(metadata_path)
    raster = metadata["raster"]
    affine = raster["affineTransform"]
    image_bounds = raster["wgs84Bounds"]
    elements = load_osm(osm_path)
    objects = build_spatial_objects(elements, from_wgs84, affine, image_bounds)
    tees = objects_by_kind(objects, "tee")
    greens = objects_by_kind(objects, "green")
    obstacles = [obj for obj in objects if obj["kind"] in {"water", "bunker"}]
    corridors = build_corridors(tees, greens, obstacles, from_wgs84, affine)
    course = json.loads(course_path.read_text(encoding="utf-8"))
    holes = build_hole_candidates(course, tees, greens, corridors, obstacles)
    corridor_by_id = {corridor["id"]: corridor for corridor in corridors}
    transitions = build_transitions(holes, corridor_by_id)

    object_counts = {}
    for obj in objects:
        object_counts[obj["kind"]] = object_counts.get(obj["kind"], 0) + 1
    status_counts = {status: sum(1 for hole in holes if hole["status"] == status) for status in (
        "unknown", "candidate", "high-confidence-inferred", "field-confirmed",
    )}
    return {
        "schemaVersion": 1,
        "courseId": "jingshanhu",
        "coordinateSystem": "EPSG:4326 / WGS84",
        "sourceCrs": f"EPSG:{raster['sourceCrs']['epsg']}",
        "orthophoto": {
            "metadataFile": "data/derived/jingshanhu/orthophoto_2023_metadata.json",
            "width": raster["width"],
            "height": raster["height"],
            "pixelSizeMetres": raster["pixelSize"],
            "wgs84Bounds": image_bounds,
            "pixelSemantics": raster["pixelCoordinateSemantics"],
        },
        "source": {
            "osmFile": "data/raw/osm-jingshanhu-golf.json",
            "osmUrl": OSM_URL,
            "osmLicense": OSM_LICENSE,
            "courseFile": "data/derived/jingshanhu/course.geojson",
            "coordinateTransform": "OSM WGS84 geometry → EPSG:4548 source CRS → affine inverse pixels; runtime output remains WGS84",
        },
        "objectIdSemantics": "G/T/B/W/P/R/C IDs are stable spatial-object IDs only; none encodes a numbered hole.",
        "objects": objects,
        "corridors": corridors,
        "holes": holes,
        "transitions": transitions,
        "summary": {
            "objectCounts": object_counts,
            "corridorCount": len(corridors),
            "holeStatusCounts": status_counts,
            "fieldConfirmedCount": sum(1 for hole in holes if hole["fieldConfirmed"]),
        },
        "warnings": [
            "OSM extract has no numbered Hole/ref tags; no high-confidence-inferred or field-confirmed mapping is emitted.",
            "Tee→Green corridors are centroid straight-line length proxies, not actual fairway centerlines.",
            "Candidate scores are capped ranking scores, not probabilities or verification confidence.",
            "Obstacle proximity is descriptive review context only and never proves a hole mapping.",
            "Adjacent-hole transitions are reported but not used for route optimization or unique numbering.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osm", type=Path, default=Path("data/raw/osm-jingshanhu-golf.json"))
    parser.add_argument("--course", type=Path, default=Path("data/derived/jingshanhu/course.geojson"))
    parser.add_argument("--metadata", type=Path, default=Path("data/derived/jingshanhu/orthophoto_2023_metadata.json"))
    parser.add_argument("--output", type=Path, default=Path("data/derived/jingshanhu/spatial-candidates.json"))
    args = parser.parse_args()
    document = build_candidates(args.osm, args.course, args.metadata)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": args.output.as_posix(),
        "objectCounts": document["summary"]["objectCounts"],
        "corridorCount": document["summary"]["corridorCount"],
        "holeStatusCounts": document["summary"]["holeStatusCounts"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

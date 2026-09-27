#!/usr/bin/env python3
"""Build a reviewable Jingshanhu topology and globally consistent mappings.

The Thread 03C JSON remains in place for backwards compatibility.  This
producer adds a second, richer candidate layer instead of silently rewriting
the old 2-tee straight-line proxy layer:

* ``teeZones``: OSM tee objects plus deterministic orthophoto review points;
* ``topologyCorridors``: image-cost-routed, multi-node tee-zone to green
  candidates;
* ``globalSolutions``: top-N beam-search assignments with unique Green and
  corridor use;
* ``greenClassifications``: area/shape priors that keep practice candidates
  visible instead of treating all 26 OSM Green objects as official holes.

The scores emitted here are candidate ranking scores, never probabilities.
No candidate is promoted to high-confidence-inferred or field-confirmed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the fallback is exercised in minimal envs
    Image = None  # type: ignore[assignment]

from pyproj import CRS, Transformer

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_jingshanhu_spatial_candidates import (  # noqa: E402
    EARTH_RADIUS_METRES,
    METRES_PER_YARD,
    WGS84,
    build_candidates,
    haversine_metres,
    nearest_water_and_bunkers,
    round_number,
)


COURSE_ID = "jingshanhu"
SCORE_MEANING = "candidate-ranking-score-not-probability"
PAR_DIRECT_METRE_RANGES: dict[int, tuple[float, float]] = {
    3: (70.0, 320.0),
    4: (160.0, 620.0),
    5: (280.0, 850.0),
}


def pixel_to_wgs84(
    column: float,
    row: float,
    affine: Sequence[float],
    to_wgs84: Transformer,
) -> list[float]:
    a, b, c, d, e, f = [float(value) for value in affine[:6]]
    source_x = a * column + b * row + c
    source_y = d * column + e * row + f
    longitude, latitude = to_wgs84.transform(source_x, source_y, errcheck=True)
    return [round_number(longitude), round_number(latitude)]


def wgs84_to_pixel(
    position: Sequence[float],
    affine: Sequence[float],
    from_wgs84: Transformer,
) -> list[float]:
    source_x, source_y = from_wgs84.transform(float(position[0]), float(position[1]), errcheck=True)
    a, b, c, d, e, f = [float(value) for value in affine[:6]]
    determinant = a * e - b * d
    column = ((source_x - c) * e - b * (source_y - f)) / determinant
    row = (a * (source_y - f) - d * (source_x - c)) / determinant
    return [round_number(column, 3), round_number(row, 3)]


def point_distance_pixels(left: Sequence[float], right: Sequence[float]) -> float:
    return math.hypot(float(left[0]) - float(right[0]), float(left[1]) - float(right[1]))


def bearing_degrees(left: Sequence[float], right: Sequence[float]) -> float:
    lat1 = math.radians(float(left[1]))
    lat2 = math.radians(float(right[1]))
    delta_lon = math.radians(float(right[0]) - float(left[0]))
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def closed_square(center: Sequence[float], half_size: float) -> list[list[float]]:
    x, y = float(center[0]), float(center[1])
    return [[x - half_size, y - half_size], [x + half_size, y - half_size],
            [x + half_size, y + half_size], [x - half_size, y + half_size],
            [x - half_size, y - half_size]]


def object_area_m2(obj: dict[str, Any]) -> float:
    bounds = obj.get("wgs84Bounds", {})
    west, east = float(bounds.get("west", 0)), float(bounds.get("east", 0))
    south, north = float(bounds.get("south", 0)), float(bounds.get("north", 0))
    latitude = math.radians((south + north) / 2)
    return max(0.0, (east - west) * 111_320.0 * math.cos(latitude) * (north - south) * 111_320.0)


def load_image_score(path: Path, width: int, height: int) -> tuple[Any, float, int, int]:
    """Return a small RGB raster and its scale; no image means a neutral fallback."""
    if Image is None or not path.exists():
        return None, 1.0, width, height
    image = Image.open(path).convert("RGB")
    scale = max(1.0, max(image.size) / 1600.0)
    small_size = (max(1, round(image.width / scale)), max(1, round(image.height / scale)))
    if small_size != image.size:
        image = image.resize(small_size, Image.Resampling.BILINEAR)
    return image, scale, image.width, image.height


def local_grass_score(image: Any, x: float, y: float, radius: int = 12) -> float:
    if image is None:
        return 0.5
    left = max(0, int(x / 1.0) - radius)
    top = max(0, int(y / 1.0) - radius)
    right = min(image.width, int(x / 1.0) + radius + 1)
    bottom = min(image.height, int(y / 1.0) + radius + 1)
    if left >= right or top >= bottom:
        return 0.0
    pixels = image.crop((left, top, right, bottom)).getdata()
    if not pixels:
        return 0.0
    score = 0.0
    for red, green, blue in pixels:
        brightness = (red + green + blue) / 765.0
        green_dominance = (green - red) / 255.0 * 0.65 + (green - blue) / 255.0 * 0.35
        # Bright, open green is preferred; dark tree canopy is down-weighted.
        score += max(0.0, min(1.0, 0.5 + green_dominance * 0.9 + brightness * 0.25))
    return score / len(pixels)


def detect_tee_zones(
    base: dict[str, Any],
    metadata: dict[str, Any],
    image_path: Path,
    affine: Sequence[float],
    to_wgs84: Transformer,
    from_wgs84: Transformer,
    desired: int = 18,
) -> list[dict[str, Any]]:
    """Find stable review points while keeping the two OSM tees explicit.

    This is intentionally a candidate detector, not a classifier.  The
    orthophoto pass samples bright grass-like patches inside the OSM course
    envelope and uses non-maximum suppression.  Every generated point carries
    the image score and the exact method so it can be rejected during field
    review.
    """
    objects = base["objects"]
    tees = sorted((obj for obj in objects if obj["kind"] == "tee"), key=lambda obj: obj["id"])
    zones: list[dict[str, Any]] = []
    for index, obj in enumerate(tees, start=1):
        pixel_center = obj["imagePixels"]["center"]
        zones.append({
            "id": f"TZ{index:02d}",
            "sourceObjectId": obj["id"],
            "center": obj["center"],
            "geometry": obj["geometry"],
            "imagePixels": {"center": pixel_center, "geometry": obj["imagePixels"]["geometry"]},
            "source": "osm",
            "detectionMethod": "osm-feature",
            "confidence": "candidate",
            "status": "candidate",
            "isOsm": True,
            "isImageInferred": False,
            "estimated": False,
            "evidence": [f"OSM 未编号 Tee 对象 {obj['id']}；仅作为空间起点候选。",
                          "OSM 没有 Hole/ref 编号，不能独立证明对应洞号。"],
            "provenance": {"source": "OpenStreetMap Overpass extract",
                            "sourceFile": "data/raw/osm-jingshanhu-golf.json",
                            "coordinateSystem": "EPSG:4326 / WGS84",
                            "detectionMethod": "OSM golf=tee object"},
        })

    raster = metadata["raster"]
    width, height = int(raster["width"]), int(raster["height"])
    image, scale, small_width, small_height = load_image_score(image_path, width, height)
    known_pixels = [obj["imagePixels"]["center"] for obj in objects if obj["kind"] in {"green", "tee"}]
    if known_pixels:
        min_x = max(0.0, min(point[0] for point in known_pixels) - 320.0)
        max_x = min(float(width), max(point[0] for point in known_pixels) + 320.0)
        min_y = max(0.0, min(point[1] for point in known_pixels) - 320.0)
        max_y = min(float(height), max(point[1] for point in known_pixels) + 320.0)
    else:
        min_x, max_x, min_y, max_y = 0.0, float(width), 0.0, float(height)
    # Work in the downsampled image while retaining source-pixel coordinates.
    sx, sy = 1.0 / scale, 1.0 / scale
    candidates: list[tuple[float, float, float]] = []
    grid_step = max(36, int(150 / scale))
    for small_y in range(max(0, int(min_y * sy)), min(small_height, int(max_y * sy) + 1), grid_step):
        for small_x in range(max(0, int(min_x * sx)), min(small_width, int(max_x * sx) + 1), grid_step):
            source_pixel = [small_x * scale, small_y * scale]
            if min((point_distance_pixels(source_pixel, known) for known in known_pixels), default=9999) < 150:
                continue
            score = local_grass_score(image, small_x, small_y)
            if score >= 0.56:
                candidates.append((score, source_pixel[0], source_pixel[1]))
    candidates.sort(key=lambda item: (-item[0], item[2], item[1]))
    selected: list[tuple[float, float, float]] = []
    for item in candidates:
        if any(math.hypot(item[1] - chosen[1], item[2] - chosen[2]) < 260 for chosen in selected):
            continue
        selected.append(item)
        if len(selected) >= max(0, desired - len(zones)):
            break

    # If the image is unavailable or too dark, retain auditable topology points
    # along the review envelope rather than claiming that detection succeeded.
    if len(selected) < desired - len(zones):
        fallback_needed = desired - len(zones) - len(selected)
        for row in range(1, 8):
            for column in range(1, 8):
                if fallback_needed <= 0:
                    break
                px = min_x + (max_x - min_x) * column / 8
                py = min_y + (max_y - min_y) * row / 8
                if any(math.hypot(px - item[1], py - item[2]) < 260 for item in selected):
                    continue
                selected.append((0.0, px, py))
                fallback_needed -= 1
            if fallback_needed <= 0:
                break

    for index, (score, pixel_x, pixel_y) in enumerate(selected, start=len(zones) + 1):
        pixel_center = [round_number(pixel_x, 3), round_number(pixel_y, 3)]
        center = pixel_to_wgs84(pixel_x, pixel_y, affine, to_wgs84)
        square_pixels = closed_square(pixel_center, 18.0)
        square_wgs84 = [pixel_to_wgs84(point[0], point[1], affine, to_wgs84) for point in square_pixels]
        detected = score > 0
        zones.append({
            "id": f"TZ{index:02d}",
            "sourceObjectId": f"IMG-TZ{index:02d}",
            "center": {"type": "Point", "coordinates": center},
            "geometry": {"type": "Polygon", "coordinates": [square_wgs84]},
            "imagePixels": {"center": pixel_center, "geometry": {"type": "Polygon", "coordinates": [square_pixels]}},
            "source": "orthophoto-inferred" if detected else "topology-inferred",
            "detectionMethod": "orthophoto-review" if detected else "corridor-endpoint",
            "confidence": "candidate",
            "status": "candidate",
            "isOsm": False,
            "isImageInferred": detected,
            "estimated": True,
            "evidence": [
                f"2023 正射影像候选采样点，局部草地/开放区评分 {score:.3f}。" if detected else "影像候选不足，使用球场范围内的拓扑补充点。",
                "该点没有 Hole/ref 或现场控制点，必须在现场确认 Tee zone。",
            ],
            "provenance": {
                "source": "2023 Jingshanhu orthophoto" if detected else "Derived topology fallback",
                "sourceFile": str(image_path.as_posix()),
                "coordinateSystem": "EPSG:4326 / WGS84",
                "detectionMethod": "grass/open-area review sampling" if detected else "deterministic envelope grid",
                "imageScore": f"{score:.3f}",
            },
        })
    return zones[:desired]


def sample_pixel_path(image: Any, points: Sequence[Sequence[float]], scale: float) -> float:
    if image is None:
        return 0.5
    values = []
    for index in range(len(points) - 1):
        x1, y1 = points[index][0] / scale, points[index][1] / scale
        x2, y2 = points[index + 1][0] / scale, points[index + 1][1] / scale
        steps = max(2, int(math.hypot(x2 - x1, y2 - y1) / 24))
        for step in range(steps + 1):
            ratio = step / steps
            values.append(local_grass_score(image, x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, radius=4))
    return sum(values) / max(1, len(values))


def route_pixels(start: Sequence[float], end: Sequence[float], image: Any, scale: float) -> tuple[list[list[float]], float]:
    """Choose a short 3-node bend with the better grass/open-area score."""
    dx, dy = float(end[0]) - float(start[0]), float(end[1]) - float(start[1])
    length = math.hypot(dx, dy)
    if length < 1 or image is None:
        return [[float(start[0]), float(start[1])], [float(end[0]), float(end[1])]], 0.5
    normal = (-dy / length, dx / length)
    bend = min(360.0, max(80.0, length * 0.12))
    midpoint = ((float(start[0]) + float(end[0])) / 2, (float(start[1]) + float(end[1])) / 2)
    options: list[tuple[float, list[list[float]]]] = []
    for sign in (-1.0, 1.0):
        control = [midpoint[0] + normal[0] * bend * sign, midpoint[1] + normal[1] * bend * sign]
        points = [[float(start[0]), float(start[1])], control, [float(end[0]), float(end[1])]]
        options.append((sample_pixel_path(image, points, scale), points))
    best_score, best_points = max(options, key=lambda item: item[0])
    return best_points, best_score


def line_length_wgs84(points: Sequence[Sequence[float]]) -> float:
    return sum(haversine_metres(points[index], points[index + 1]) for index in range(len(points) - 1))


def route_shape(points: Sequence[Sequence[float]]) -> tuple[str, list[float]]:
    bearings = [bearing_degrees(points[index], points[index + 1]) for index in range(len(points) - 1)]
    if len(bearings) < 2:
        return "straight", bearings
    turns = [((bearings[index] - bearings[index - 1] + 540) % 360) - 180 for index in range(1, len(bearings))]
    significant = [turn for turn in turns if abs(turn) >= 18]
    if not significant:
        return "straight", bearings
    return ("left-dogleg" if sum(significant) < 0 else "right-dogleg"), bearings


def classify_greens(base: dict[str, Any]) -> list[dict[str, Any]]:
    greens = [obj for obj in base["objects"] if obj["kind"] == "green"]
    ranked = sorted(greens, key=lambda obj: (-object_area_m2(obj), obj["id"]))
    primary = {obj["id"] for obj in ranked[:18]}
    output = []
    for obj in sorted(greens, key=lambda item: item["id"]):
        area = object_area_m2(obj)
        if obj["id"] in primary:
            classification = "primary-course"
            evidence = [f"Green {obj['id']} 面积/形状先验约 {area:.0f} m²，位于 26 个候选中较大的一组。",
                        "这是正式 18 洞候选分类，不是洞号确认；仍需路线和现场证据。"]
        elif area < 230:
            classification = "practice"
            evidence = [f"Green {obj['id']} 面积/形状先验约 {area:.0f} m²，较小，优先标为 practice 候选。",
                        "面积规则可能误伤短洞 Green，保持 candidate/unknown 供复查。"]
        else:
            classification = "unknown"
            evidence = [f"Green {obj['id']} 面积先验约 {area:.0f} m²，无法在正式球洞与训练区之间区分。"]
        output.append({
            "id": obj["id"], "sourceObjectId": obj["id"], "classification": classification,
            "center": obj["center"], "geometry": obj["geometry"],
            "status": "candidate", "areaMetresSquared": round_number(area, 1),
            "evidence": evidence,
            "provenance": {"source": "OSM Green geometry + orthophoto review", "sourceFile": "data/raw/osm-jingshanhu-golf.json", "coordinateSystem": "EPSG:4326 / WGS84", "method": "area/shape prior only"},
        })
    return output


def build_topology_corridors(
    base: dict[str, Any],
    tee_zones: list[dict[str, Any]],
    metadata: dict[str, Any],
    image_path: Path,
    affine: Sequence[float],
    to_wgs84: Transformer,
    from_wgs84: Transformer,
) -> list[dict[str, Any]]:
    raster = metadata["raster"]
    image, scale, _, _ = load_image_score(image_path, int(raster["width"]), int(raster["height"]))
    green_objects = sorted((obj for obj in base["objects"] if obj["kind"] == "green"), key=lambda obj: obj["id"])
    obstacles = [obj for obj in base["objects"] if obj["kind"] in {"water", "bunker"}]
    corridors: list[dict[str, Any]] = []
    for zone in tee_zones:
        tee_pixel = zone["imagePixels"]["center"]
        for green in green_objects:
            green_pixel = green["imagePixels"]["center"]
            pixel_points, route_score = route_pixels(tee_pixel, green_pixel, image, scale)
            centerline = [pixel_to_wgs84(point[0], point[1], affine, to_wgs84) for point in pixel_points]
            shape, bearings = route_shape(centerline)
            length = line_length_wgs84(centerline)
            nearby_water, nearby_bunkers = nearest_water_and_bunkers(centerline[0], centerline[-1], obstacles)
            index = len(corridors) + 1
            corridor_id = f"TC{index:03d}"
            corridors.append({
                "id": corridor_id,
                "kind": "hole-corridor-candidate",
                "teeZone": zone["id"],
                "teeZoneId": zone["id"],
                "tee": zone["sourceObjectId"],
                "green": green["id"],
                "centerline": {"type": "LineString", "coordinates": centerline},
                "imagePixels": {"geometry": {"type": "LineString", "coordinates": pixel_points}},
                "approximateLengthMetres": round_number(length, 2),
                "lengthMetres": round_number(length, 2),
                "bearingSequence": [round_number(value, 1) for value in bearings],
                "shape": shape,
                "nearbyWater": nearby_water,
                "nearbyBunkers": nearby_bunkers,
                "nearbyWaterIds": nearby_water,
                "nearbyBunkerIds": nearby_bunkers,
                "geometryRole": "orthophoto-routed-hole-corridor",
                "centerlineStatus": "estimated" if image is not None else "unknown",
                "isProxy": image is None,
                "estimated": True,
                "status": "candidate",
                "routeGrassScore": round_number(route_score, 3),
                "evidence": [
                    f"Tee zone {zone['id']} → Green {green['id']}，沿影像开放草地区域生成 {len(centerline)} 节点 centerline。" if image is not None else f"Tee zone {zone['id']} → Green {green['id']} 使用直线 fallback，未读取影像。",
                    f"路线局部影像评分 {route_score:.3f}，只用于候选排序，不代表球道实测。",
                    "Tee zone 与 Green 均未带 Hole/ref，不能单独确认洞号。",
                ],
                "provenance": {
                    "source": "2023 orthophoto + OSM Green/Tee/obstacle overlay",
                    "sourceFile": str(image_path.as_posix()),
                    "coordinateSystem": "EPSG:4326 / WGS84",
                    "method": "deterministic grass/open-area route with one dogleg control point",
                },
            })
    return corridors


def build_topology_transitions(
    base: dict[str, Any],
    tee_zones: list[dict[str, Any]],
    corridors: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build compact Green/corridor -> next Tee-zone transition edges.

    A full corridor-to-corridor cross product would repeat the same Green to
    Tee-zone cost hundreds of times. Each edge therefore identifies its source
    corridor and target Tee zone; any corridor using that target zone can be
    joined by the global solution layer.
    """
    greens_by_id = {
        obj["id"]: obj["center"]["coordinates"]
        for obj in base["objects"]
        if obj["kind"] == "green"
    }
    transitions: list[dict[str, Any]] = []
    for corridor in corridors:
        from_green = greens_by_id.get(corridor["green"])
        if not from_green:
            continue
        for zone in tee_zones:
            distance = haversine_metres(from_green, zone["center"]["coordinates"])
            reuse_penalty = 8.0 if corridor["teeZone"] == zone["id"] else 0.0
            cost = distance + reuse_penalty
            transitions.append({
                "id": f"TR-{corridor['id']}-{zone['id']}",
                "fromCorridor": corridor["id"],
                "fromCorridorId": corridor["id"],
                "fromGreen": corridor["green"],
                "fromGreenId": corridor["green"],
                "toTeeZone": zone["id"],
                "toTeeZoneId": zone["id"],
                "costMetres": round_number(cost, 2),
                "transitionCostMetres": round_number(cost, 2),
                "straightDistanceMetres": round_number(distance, 2),
                "cartPathDistanceMetres": None,
                "crossingPenalty": round_number(reuse_penalty, 2),
                "routeSection": "unknown",
                "status": "candidate",
                "evidence": [
                    "Green→下一 Tee zone 使用 WGS84 欧氏距离作为软约束。",
                    "当前没有可路由的 cart path 网络；该边不代表实际球车路线。",
                ],
            })
    return transitions


def add_solution_transitions(solutions: list[dict[str, Any]]) -> None:
    """Attach the 17 ordered Hole transitions to every global solution."""
    for solution in solutions:
        entries = solution.get("entries", [])
        solution["transitions"] = []
        for previous, current in zip(entries, entries[1:]):
            solution["transitions"].append({
                "fromHole": previous["hole"],
                "toHole": current["hole"],
                "fromCorridorId": previous.get("corridor"),
                "toCorridorId": current.get("corridor"),
                "costMetres": round_number(current.get("transitionFromPreviousMetres") or 0.0, 2),
                "transitionCostMetres": round_number(current.get("transitionFromPreviousMetres") or 0.0, 2),
                "routeSection": "front-nine" if current["hole"] <= 9 else "back-nine",
                "status": "candidate",
            })
        solution["assignments"] = entries


def match_score(corridor: dict[str, Any], hole: dict[str, Any], green_class: dict[str, Any], zone: dict[str, Any]) -> dict[str, Any]:
    yardages = [(name, int(value), int(value) * METRES_PER_YARD) for name, value in hole.get("teeYardages", {}).items()]
    if not yardages:
        variant, yardage, target = "unknown", 0, corridor["lengthMetres"]
    else:
        variant, yardage, target = min(yardages, key=lambda item: abs(corridor["lengthMetres"] - item[2]))
    relative_error = abs(corridor["lengthMetres"] - target) / max(1.0, target)
    length_score = max(0.0, min(1.0, 1.0 - relative_error / 0.9))
    par = int(hole.get("par") or 4)
    range_min, range_max = PAR_DIRECT_METRE_RANGES.get(par, (80.0, 700.0))
    par_score = 1.0 if range_min <= corridor["lengthMetres"] <= range_max else 0.35
    green_score = 0.12 if green_class.get("classification") == "primary-course" else 0.0
    image_score = 0.08 * float(corridor.get("routeGrassScore", 0.5))
    tee_score = 0.04 if zone.get("source") == "osm" else 0.025
    score = min(0.74, max(0.0, 0.48 * length_score + 0.12 * par_score + green_score + image_score + tee_score))
    evidence = [
        f"路线长度约 {corridor['lengthMetres']:.0f} m；最接近 {variant} {yardage} yd（{target:.0f} m），相对差 {relative_error:.0%}。",
        f"{corridor['shape']} corridor，包含 {len(corridor['centerline']['coordinates'])} 个 centerline 节点。",
        "全局方案中作为特征匹配分；排序分不是概率。",
    ]
    conflicts = [
        "没有 Hole/ref、逐洞图或现场控制点，保持 candidate。",
        "影像路线是近似几何，不能替代实测球道中心线。",
    ]
    if green_class.get("classification") != "primary-course":
        conflicts.append(f"Green {corridor['green']} 尚未归入正式 18 洞高优先分类。")
    return {
        "tee": corridor["tee"], "teeZone": corridor["teeZone"], "green": corridor["green"], "corridor": corridor["id"],
        "score": round_number(score, 4), "matchedTeeVariant": variant, "matchedYardage": yardage,
        "targetMetres": round_number(target, 2), "lineLengthMetres": round_number(corridor["lengthMetres"], 2),
        "relativeLengthError": round_number(relative_error, 4), "evidence": evidence, "conflicts": conflicts,
    }


def build_candidate_lists(base: dict[str, Any], corridors: list[dict[str, Any]], classifications: list[dict[str, Any]], zones: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    holes_by_number = {int(hole["hole"]): hole for hole in base["holes"]}
    classification_by_id = {item["id"]: item for item in classifications}
    zone_by_id = {zone["id"]: zone for zone in zones}
    lists: list[list[dict[str, Any]]] = []
    for hole_number in range(1, 19):
        hole = holes_by_number[hole_number]
        matches = [match_score(corridor, hole, classification_by_id[corridor["green"]], zone_by_id[corridor["teeZone"]]) for corridor in corridors]
        matches.sort(key=lambda item: (-item["score"], item["green"], item["teeZone"], item["corridor"]))
        lists.append(matches[:24])
    return lists


def transition_cost(left: dict[str, Any], right: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> float:
    left_green = left["greenCenter"]
    right_tee = zones_by_id[right["teeZone"]]["center"]["coordinates"]
    distance = haversine_metres(left_green, right_tee)
    # Sharing a tee zone is allowed but explicit; sharing a Green is forbidden
    # by the search.  The small reuse cost discourages arbitrary switching.
    return distance + (8.0 if left["teeZone"] == right["teeZone"] else 0.0)


def solve_global(base: dict[str, Any], zones: list[dict[str, Any]], corridors: list[dict[str, Any]], classifications: list[dict[str, Any]], top_n: int = 3) -> list[dict[str, Any]]:
    lists = build_candidate_lists(base, corridors, classifications, zones)
    greens_by_id = {obj["id"]: obj["center"]["coordinates"] for obj in base["objects"] if obj["kind"] == "green"}
    zones_by_id = {zone["id"]: zone for zone in zones}
    states: list[dict[str, Any]] = []
    beam_width = 640
    for index, candidates in enumerate(lists):
        next_states: list[dict[str, Any]] = []
        hole_number = index + 1
        choices = candidates + [None]
        if not states:
            states = [{"entries": [], "usedGreen": set(), "usedCorridor": set(), "feature": 0.0, "transition": 0.0, "conflicts": 0, "unknown": 0, "last": None}]
        for state in states:
            for match in choices:
                if match is None:
                    next_states.append({**state, "entries": state["entries"] + [{"hole": hole_number, "status": "unknown", "candidate": None, "teeZone": None, "green": None, "corridor": None, "transitionFromPreviousMetres": None, "featureMatchScore": 0.0, "evidence": ["没有与既有 Green/corridor 冲突的候选，保持 unknown。"], "conflicts": ["没有为了得到 18/18 而强行补齐。"]}], "unknown": state["unknown"] + 1, "conflicts": state["conflicts"] + 1, "last": None})
                    continue
                if match["green"] in state["usedGreen"] or match["corridor"] in state["usedCorridor"]:
                    continue
                previous = state["last"]
                current_green = greens_by_id[match["green"]]
                previous_transition = None
                extra_transition = 0.0
                if previous is not None:
                    previous_transition = transition_cost(previous, {"teeZone": match["teeZone"]}, zones_by_id) if previous.get("greenCenter") else None
                    extra_transition = previous_transition or 0.0
                entry = {"hole": hole_number, "status": "candidate", "candidate": match, "teeZone": match["teeZone"], "teeZoneId": match["teeZone"], "teeObjectId": match["tee"], "green": match["green"], "greenId": match["green"], "corridor": match["corridor"], "corridorId": match["corridor"], "transitionFromPreviousMetres": round_number(previous_transition, 2) if previous_transition is not None else None, "featureMatchScore": match["score"], "candidateScore": match["score"], "mappingIndependentEvidence": False, "fieldConfirmed": False, "independentEvidenceSources": [], "evidence": match["evidence"], "conflicts": match["conflicts"]}
                next_states.append({"entries": state["entries"] + [entry], "usedGreen": state["usedGreen"] | {match["green"]}, "usedCorridor": state["usedCorridor"] | {match["corridor"]}, "feature": state["feature"] + match["score"], "transition": state["transition"] + extra_transition, "conflicts": state["conflicts"] + len(match["conflicts"]), "unknown": state["unknown"], "last": {"teeZone": match["teeZone"], "greenCenter": current_green}})
        def score(state: dict[str, Any]) -> float:
            return state["feature"] / 18.0 - 0.00011 * state["transition"] - 0.13 * state["unknown"] - 0.0005 * state["conflicts"]
        # Deterministic beam pruning; signature keeps equivalent tails apart.
        unique: dict[str, dict[str, Any]] = {}
        for state in sorted(next_states, key=lambda item: (-score(item), ".".join(entry.get("corridor") or "unknown" for entry in item["entries"]))):
            signature = "|".join(entry.get("corridor") or "unknown" for entry in state["entries"][-5:])
            if signature not in unique:
                unique[signature] = state
        states = sorted(unique.values(), key=lambda item: (-score(item), ".".join(entry.get("corridor") or "unknown" for entry in item["entries"])))[:beam_width]
    states.sort(key=lambda item: (-item["feature"] / 18.0 + 0.00011 * item["transition"] + 0.13 * item["unknown"] + 0.0005 * item["conflicts"], ".".join(entry.get("corridor") or "unknown" for entry in item["entries"])))
    solutions: list[dict[str, Any]] = []
    signatures: set[str] = set()
    for state in states:
        signature = "|".join(entry.get("corridor") or "unknown" for entry in state["entries"])
        if signature in signatures:
            continue
        signatures.add(signature)
        index = len(solutions) + 1
        feature_score = state["feature"] / 18.0
        ranking_score = feature_score - 0.00011 * state["transition"] - 0.13 * state["unknown"] - 0.0005 * state["conflicts"]
        solutions.append({
            "id": f"S{index:02d}", "rankingScore": round_number(ranking_score, 4), "scoreMeaning": SCORE_MEANING,
            "featureMatchScore": round_number(feature_score, 4), "transitionCostMetres": round_number(state["transition"], 1),
            "conflictCount": state["conflicts"], "unresolvedHoleCount": state["unknown"], "entries": state["entries"],
            "differences": [], "status": "candidate",
            "evidence": ["Hole 1→18 采用 beam search 全局匹配，而不是 18 次独立 argmax。", "单一方案内 Green 和 corridor 一对一；Tee zone 可解释地复用。", "所有 score 都是候选排序分，不是概率。"],
            "warnings": ["没有独立洞号证据，所有条目保持 candidate。"],
        })
        if len(solutions) >= top_n:
            break
    for index, solution in enumerate(solutions):
        if index == 0:
            solution["differences"] = ["排序最高的全局方案；无上一方案可比较。"]
        else:
            previous = solutions[index - 1]
            differences = [f"Hole {entry['hole']}: {entry.get('corridor') or 'unknown'}" for entry, old in zip(solution["entries"], previous["entries"]) if entry.get("corridor") != old.get("corridor")]
            solution["differences"] = differences or ["与上一方案的 Hole→corridor 分配一致。"]
    return solutions


def build_field_validation_plan(document: dict[str, Any]) -> str:
    solutions = document.get("globalSolutions", [])
    first = solutions[0] if solutions else {"entries": []}
    second = solutions[1] if len(solutions) > 1 else None
    lines = ["# 净山湖第一次现场验证计划", "", "生成自 Thread 03D 全局候选方案。所有条目仍是 candidate；现场记录不会自动提升状态。", "", "## 总体状态", ""]
    summary = document.get("summary", {})
    lines.append(f"- Tee zone 候选：{summary.get('teeZoneCount', 0)}（OSM 与正射影像/拓扑候选混合）。")
    lines.append(f"- Green 候选：{summary.get('objectCounts', {}).get('green', 0)}；其中面积/形状先验归入 primary-course：{summary.get('greenClassificationCounts', {}).get('primary-course', 0)}。")
    lines.append(f"- Top 全局方案：{len(solutions)}；排序分含义：候选排序分，不是概率。")
    lines.append("")
    lines.append("## 优先核对洞")
    lines.append("")
    for entry in first.get("entries", []):
        hole = entry["hole"]
        alternatives = [item for item in (second or {}).get("entries", []) if item["hole"] == hole]
        other = alternatives[0].get("corridor") if alternatives else None
        current = entry.get("corridor")
        if not current:
            reason = "当前全局方案保持 unknown，现场优先寻找 Tee/Green 起点。"
        elif other and other != current:
            reason = f"Top 方案之间存在替代 corridor：{current} ↔ {other}；重点记录 Tee zone、球道转折和 Green。"
        else:
            reason = "全局路线较稳定，但缺少独立洞号证据；现场记录入口/出口和转场方向。"
        lines.append(f"### Hole {hole}")
        lines.append(f"- 当前候选：{current or 'unknown'} / Green {entry.get('green') or 'unknown'}。")
        lines.append(f"- 现场重点：{reason}")
        lines.append("- 建议记录：Tee 标牌或熟悉球场者确认、Green 中心 GPS、球车道转场、明显水体/沙坑关系。")
        lines.append("")
    lines.extend(["## 现场记录规则", "", "1. 先记录系统预测 Hole、时间、WGS84 位置和 GPS accuracy。", "2. 由现场标牌、球场官方或熟悉球场者给出实际洞号；不确定时记录 uncertain。", "3. 事件写入现场确认事件结构，不直接改写 spatial-candidates.json 或 course.geojson。"])
    return "\n".join(lines) + "\n"


def build_topology_document(base: dict[str, Any], metadata: dict[str, Any], image_path: Path) -> dict[str, Any]:
    raster = metadata["raster"]
    source_crs = CRS.from_epsg(int(raster["sourceCrs"]["epsg"]))
    to_wgs84 = Transformer.from_crs(source_crs, WGS84, always_xy=True)
    from_wgs84 = Transformer.from_crs(WGS84, source_crs, always_xy=True)
    affine = raster["affineTransform"]
    zones = detect_tee_zones(base, metadata, image_path, affine, to_wgs84, from_wgs84)
    classifications = classify_greens(base)
    corridors = build_topology_corridors(base, zones, metadata, image_path, affine, to_wgs84, from_wgs84)
    transitions = build_topology_transitions(base, zones, corridors)
    solutions = solve_global(base, zones, corridors, classifications)
    add_solution_transitions(solutions)
    object_counts = base["summary"]["objectCounts"]
    class_counts: dict[str, int] = {}
    for item in classifications:
        class_counts[item["classification"]] = class_counts.get(item["classification"], 0) + 1
    document = {
        **base,
        "schemaVersion": 2,
        "scoreMeaning": SCORE_MEANING,
        "teeZones": zones,
        "greenClassifications": classifications,
        "topologyCorridors": corridors,
        "topologyTransitions": transitions,
        "globalSolutions": solutions,
        "topology": {
            "schemaVersion": 1, "courseId": COURSE_ID, "coordinateSystem": base["coordinateSystem"],
            "teeZones": zones, "greens": classifications, "corridors": corridors, "transitions": transitions,
            "warnings": ["当前没有 cart path 路网，转场使用 Green→Tee 的 WGS84 欧氏近似。"],
            "provenance": {"method": "scripts/build_jingshanhu_topology.py", "coordinateSystem": base["coordinateSystem"]},
        },
        "summary": {
            **base["summary"], "teeZoneCount": len(zones), "topologyCorridorCount": len(corridors),
            "globalSolutionCount": len(solutions), "greenClassificationCounts": class_counts,
        },
        "warnings": [
            *base["warnings"],
            "Thread 03D 新增 Tee zone、Green 分类和 topologyCorridors 均为 candidate/estimated，不代表洞号事实。",
            "topologyCorridors 的 centerline 由正射影像草地/开放区代价启发式生成，现场前不得视为实测球道。",
            "globalSolutions 使用 beam search 强制单一方案内 Green/corridor 唯一；Tee zone 允许软约束复用。",
            "面积/形状 Green 分类只是正式 18 洞可能性先验，无法独立排除 practice 或 training 区。",
        ],
    }
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osm", type=Path, default=Path("data/raw/osm-jingshanhu-golf.json"))
    parser.add_argument("--course", type=Path, default=Path("data/derived/jingshanhu/course.geojson"))
    parser.add_argument("--metadata", type=Path, default=Path("data/derived/jingshanhu/orthophoto_2023_metadata.json"))
    parser.add_argument("--image", type=Path, default=Path("data/raw/jingshanhu_orthophoto_2023/净山湖高尔夫球场2023/净山湖高尔夫球场2023.tif"))
    parser.add_argument("--output", type=Path, default=Path("data/derived/jingshanhu/spatial-candidates.json"))
    parser.add_argument("--field-plan", type=Path, default=Path("data/metadata/jingshanhu_field_validation_plan.md"))
    args = parser.parse_args()
    base = build_candidates(args.osm, args.course, args.metadata)
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    document = build_topology_document(base, metadata, args.image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.field_plan.parent.mkdir(parents=True, exist_ok=True)
    args.field_plan.write_text(build_field_validation_plan(document), encoding="utf-8")
    print(json.dumps({
        "output": args.output.as_posix(), "teeZoneCount": document["summary"]["teeZoneCount"],
        "greenClassificationCounts": document["summary"]["greenClassificationCounts"],
        "topologyCorridorCount": document["summary"]["topologyCorridorCount"],
        "globalSolutionCount": document["summary"]["globalSolutionCount"],
        "fieldPlan": args.field_plan.as_posix(),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

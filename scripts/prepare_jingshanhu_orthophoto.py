#!/usr/bin/env python3
"""Validate and prepare the Jingshanhu 2023 orthophoto for local review."""

from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.enums import ColorInterp
from rasterio.warp import transform_bounds

WGS84 = CRS.from_epsg(4326)
WORLD_FILE_NAMES = (".tfw", ".tifw", ".wld")


def find_sidecar(raster_path: Path, suffixes: tuple[str, ...]) -> Path | None:
    for child in raster_path.parent.iterdir():
        if child.stem.casefold() == raster_path.stem.casefold() and child.suffix.casefold() in suffixes:
            return child
    return None


def pixel_to_source(transform: rasterio.Affine, column: float, row: float) -> tuple[float, float]:
    """Convert continuous pixel-edge coordinates; add 0.5 for a pixel center."""
    x, y = transform * (column, row)
    return float(x), float(y)


def source_to_wgs84(transformer: Transformer, x: float, y: float) -> tuple[float, float]:
    longitude, latitude = transformer.transform(x, y, errcheck=True)
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        raise ValueError(f"Invalid WGS84 coordinate: {longitude}, {latitude}")
    return float(longitude), float(latitude)


def load_world_file(path: Path) -> list[float]:
    values = [float(line.strip()) for line in path.read_text(encoding="ascii").splitlines() if line.strip()]
    if len(values) != 6 or not all(math.isfinite(value) for value in values):
        raise ValueError(f"World file must contain six finite values: {path}")
    return values


def verify_world_file(transform: rasterio.Affine, values: list[float]) -> dict[str, Any]:
    a, d, b, e, c, f = values
    world_center = (c, f)
    raster_first_center = pixel_to_source(transform, 0.5, 0.5)
    coefficient_deltas = {
        "pixelWidth": transform.a - a,
        "rowRotation": transform.d - d,
        "columnRotation": transform.b - b,
        "pixelHeight": transform.e - e,
    }
    tolerance = 1e-6
    size_and_rotation_match = all(abs(value) <= tolerance for value in coefficient_deltas.values())
    raster_origin = (transform.c, transform.f)
    origin_delta = (world_center[0] - raster_origin[0], world_center[1] - raster_origin[1])
    center_delta = (world_center[0] - raster_first_center[0], world_center[1] - raster_first_center[1])
    origin_matches = all(abs(value) <= tolerance for value in origin_delta)
    center_matches = all(abs(value) <= tolerance for value in center_delta)
    if not size_and_rotation_match or not (origin_matches or center_matches):
        raise ValueError(f"GeoTIFF transform and world file differ beyond a recognized pixel-origin convention: {coefficient_deltas}")
    return {
        "parameterOrder": ["A", "D", "B", "E", "C", "F"],
        "values": values,
        "tfwCAndF": {"sourceX": c, "sourceY": f},
        "rasterUpperLeftCorner": {"sourceX": raster_origin[0], "sourceY": raster_origin[1]},
        "rasterFirstPixelCenter": {"sourceX": raster_first_center[0], "sourceY": raster_first_center[1]},
        "pixelSizeAndRotationMatch": size_and_rotation_match,
        "tfwCAndFMatchGeoTiffCorner": origin_matches,
        "standardWorldFilePixelCenterMatch": center_matches,
        "halfPixelOffsetMetres": math.hypot(*center_delta),
        "comparisonTolerance": tolerance,
        "deltas": coefficient_deltas,
        "pixelCornerNote": "Standard TFW C/F identify the center of the upper-left pixel; this file's C/F match the GeoTIFF upper-left pixel corner instead.",
    }


def inspect_kml(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    root = ET.fromstring(path.read_bytes())
    coordinate_type = next((node.text for node in root.iter() if node.tag.endswith("OvCoordType")), None)
    coordinate_text = next((node.text for node in root.iter() if node.tag.endswith("coordinates") and node.text), None)
    if not coordinate_text:
        return {"file": path.name, "geometryType": "unknown", "coordinateType": coordinate_type}
    coordinates = []
    for token in coordinate_text.split():
        values = [float(value) for value in token.split(",")]
        if len(values) < 2:
            raise ValueError(f"Invalid KML coordinate token: {token}")
        coordinates.append((values[0], values[1]))
    if coordinate_type and "CGCS2000" in coordinate_type.upper():
        to_wgs84 = Transformer.from_crs(CRS.from_epsg(4490), WGS84, always_xy=True)
        coordinates = [to_wgs84.transform(lon, lat, errcheck=True) for lon, lat in coordinates]
        input_crs = "EPSG:4490 (CGCS2000 geographic)"
    else:
        input_crs = "KML longitude/latitude; no explicit datum marker"
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "geometryType": "polygon-envelope",
        "coordinateTypeMarker": coordinate_type,
        "inputCrsInterpretation": input_crs,
        "wgs84Bounds": {
            "west": min(point[0] for point in coordinates),
            "south": min(point[1] for point in coordinates),
            "east": max(point[0] for point in coordinates),
            "north": max(point[1] for point in coordinates),
        },
        "holeNumbered": False,
        "use": "Course-area envelope only; not a hole layout or control-point set.",
    }


def describe_files(source_dir: Path) -> list[dict[str, Any]]:
    records = []
    for path in sorted(source_dir.rglob("*")):
        if path.is_file():
            records.append({
                "name": path.name,
                "relativePath": path.relative_to(source_dir).as_posix(),
                "extension": path.suffix.lower(),
                "bytes": path.stat().st_size,
            })
    return records


def alpha_summary(dataset: rasterio.io.DatasetReader) -> dict[str, Any]:
    alpha_indexes = [index + 1 for index, color in enumerate(dataset.colorinterp) if color == ColorInterp.alpha]
    if not alpha_indexes:
        return {"present": False, "nodata": list(dataset.nodatavals)}
    alpha = dataset.read(alpha_indexes[0])
    return {
        "present": True,
        "band": alpha_indexes[0],
        "min": int(alpha.min()),
        "max": int(alpha.max()),
        "transparentPixels": int(np.count_nonzero(alpha == 0)),
        "partialAlphaPixels": int(np.count_nonzero((alpha > 0) & (alpha < 255))),
        "opaquePixels": int(np.count_nonzero(alpha == 255)),
        "nodata": list(dataset.nodatavals),
        "maskFlags": [[flag.name for flag in flags] for flags in dataset.mask_flag_enums],
    }


def make_preview(dataset: rasterio.io.DatasetReader, output_path: Path) -> None:
    rgb = np.moveaxis(dataset.read((1, 2, 3)), 0, -1)
    alpha_indexes = [index + 1 for index, color in enumerate(dataset.colorinterp) if color == ColorInterp.alpha]
    if alpha_indexes:
        alpha = dataset.read(alpha_indexes[0])
        background = np.array([250, 250, 247], dtype=np.uint16)
        rgb = ((rgb.astype(np.uint16) * alpha[..., None] + background * (255 - alpha[..., None]) + 127) // 255).astype(np.uint8)
    Image.fromarray(rgb, mode="RGB").save(output_path, format="JPEG", quality=91, optimize=True, progressive=True)


def make_small_preview(preview_path: Path, output_path: Path, max_dimension: int = 1024) -> None:
    """Create a small committed review image; the full preview remains ignored."""
    with Image.open(preview_path) as image:
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        image.save(output_path, format="JPEG", quality=88, optimize=True, progressive=True)


def prepare(raster_path: Path, source_dir: Path, output_dir: Path) -> dict[str, Any]:
    if not raster_path.exists():
        raise FileNotFoundError(raster_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    world_path = find_sidecar(raster_path, WORLD_FILE_NAMES)
    prj_path = find_sidecar(raster_path, (".prj",))
    kml_path = find_sidecar(raster_path, (".kml",))
    txt_path = find_sidecar(raster_path, (".txt",))
    if world_path is None or prj_path is None:
        raise ValueError("Matching TFW and PRJ sidecars are required for source validation.")

    preview_path = output_dir / "orthophoto_2023_preview.jpg"
    small_preview_path = output_dir / "orthophoto_2023_preview_small.jpg"
    metadata_path = output_dir / "orthophoto_2023_metadata.json"
    with rasterio.open(raster_path) as dataset:
        if dataset.crs is None:
            raise ValueError("The raster has no embedded CRS.")
        raster_crs = CRS.from_user_input(dataset.crs)
        prj_container_crs = CRS.from_wkt(prj_path.read_text(encoding="utf-8"))
        prj_crs = prj_container_crs.source_crs if prj_container_crs.is_bound else prj_container_crs
        raster_epsg = raster_crs.to_epsg()
        projected_parameters_match = (
            raster_crs.is_projected and prj_crs.is_projected and
            raster_crs.geodetic_crs.equals(prj_crs.geodetic_crs, ignore_axis_order=True) and
            raster_crs.coordinate_operation == prj_crs.coordinate_operation
        )
        prj_epsg = raster_epsg if projected_parameters_match else prj_crs.to_epsg()
        world = verify_world_file(dataset.transform, load_world_file(world_path))
        if raster_epsg is None or raster_epsg != prj_epsg:
            raise ValueError(f"GeoTIFF EPSG {raster_epsg} does not match PRJ EPSG {prj_epsg}.")

        to_wgs84 = Transformer.from_crs(raster_crs, WGS84, always_xy=True)
        from_wgs84 = Transformer.from_crs(WGS84, raster_crs, always_xy=True)
        corners = {
            "upperLeft": (0.0, 0.0),
            "upperRight": (float(dataset.width), 0.0),
            "lowerRight": (float(dataset.width), float(dataset.height)),
            "lowerLeft": (0.0, float(dataset.height)),
        }
        wgs_corners = {
            name: source_to_wgs84(to_wgs84, *pixel_to_source(dataset.transform, *pixel))
            for name, pixel in corners.items()
        }
        sample_pixels = {
            "upperLeftPixelCenter": (0.5, 0.5),
            "upperRightPixelCenter": (dataset.width - 0.5, 0.5),
            "lowerRightPixelCenter": (dataset.width - 0.5, dataset.height - 0.5),
            "lowerLeftPixelCenter": (0.5, dataset.height - 0.5),
            "imageCenter": (dataset.width / 2, dataset.height / 2),
        }
        sample_points = {}
        for name, pixel in sample_pixels.items():
            source = pixel_to_source(dataset.transform, *pixel)
            lonlat = source_to_wgs84(to_wgs84, *source)
            returned_source = from_wgs84.transform(*lonlat, errcheck=True)
            roundtrip = ~dataset.transform * returned_source
            pixel_error = math.hypot(roundtrip[0] - pixel[0], roundtrip[1] - pixel[1])
            source_error = math.hypot(returned_source[0] - source[0], returned_source[1] - source[1])
            if pixel_error > 1e-6 or source_error > 1e-4:
                raise ValueError(f"Pixel/CRS roundtrip exceeds tolerance at {name}: {pixel_error} px, {source_error} m")
            sample_points[name] = {
                "pixel": list(pixel),
                "source": list(source),
                "wgs84": list(lonlat),
                "roundTripPixelError": pixel_error,
                "roundTripSourceErrorMetres": source_error,
            }

        bounds = dataset.bounds
        west, south, east, north = transform_bounds(
            raster_crs, WGS84, bounds.left, bounds.bottom, bounds.right, bounds.top, densify_pts=41,
        )
        make_preview(dataset, preview_path)
        make_small_preview(preview_path, small_preview_path)
        raster = {
            "file": raster_path.name,
            "driver": dataset.driver,
            "width": dataset.width,
            "height": dataset.height,
            "bandCount": dataset.count,
            "dtypes": list(dataset.dtypes),
            "bitsPerSample": [np.dtype(dtype).itemsize * 8 for dtype in dataset.dtypes],
            "colorInterpretation": [color.name for color in dataset.colorinterp],
            "pixelSize": {"x": dataset.res[0], "y": dataset.res[1], "unit": "metre"},
            "affineTransform": list(dataset.transform)[:6],
            "sourceCrs": {
                "name": raster_crs.name,
                "wkt": raster_crs.to_wkt(),
                "epsg": raster_epsg,
                "axisOrderNote": "Affine x/y are easting/northing; pyproj Transformer uses always_xy=True.",
            },
            "prj": {
                "file": prj_path.name,
                "epsg": prj_epsg,
                "matchesRasterAuthority": True,
                "normalizedEqualsIgnoringAxisOrder": projected_parameters_match,
                "sameGeodeticBaseAndProjection": projected_parameters_match,
                "isBoundCrs": prj_container_crs.is_bound,
                "boundTransformation": prj_container_crs.coordinate_operation.name if prj_container_crs.is_bound else None,
                "wktNote": "The PRJ wraps projected EPSG:4548 in a BoundCRS with a zero-valued CGCS2000-to-WGS84 transformation; its projected source CRS is compared to the GeoTIFF CRS.",
            },
            "worldFile": {"file": world_path.name, **world},
            "kmlReference": inspect_kml(kml_path),
            "textSidecar": {
                "file": txt_path.name,
                "bytes": txt_path.stat().st_size,
                "encoding": "GBK",
                "text": txt_path.read_bytes().decode("gbk", errors="replace"),
            } if txt_path else None,
            "projectedBounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
            "wgs84CornerCoordinates": {name: list(value) for name, value in wgs_corners.items()},
            "wgs84Bounds": {"west": west, "south": south, "east": east, "north": north},
            "pixelCoordinateSemantics": "Continuous pixel-edge coordinates; the center of column c, row r is (c+0.5, r+0.5).",
            "pixelCenterSamples": sample_points,
            "wgs84Transformation": {
                "target": "EPSG:4326",
                "library": "pyproj",
                "alwaysXY": True,
                "description": to_wgs84.description,
                "definition": to_wgs84.definition,
                "accuracyMetres": to_wgs84.accuracy,
                "independentDatumValidation": False,
                "precisionLimitation": "当前仅使用 pyproj 可用的 EPSG:4548 → WGS84 转换；没有现场控制点、RTK 或其他独立基准验证。正射影像约 0.26 m/pixel 不等于最终 WGS84 绝对坐标具有同等精度。",
            },
            "alphaAndNoData": alpha_summary(dataset),
            "preview": {
                "file": preview_path.name,
                "width": dataset.width,
                "height": dataset.height,
                "format": "JPEG",
                "quality": 91,
                "backgroundForTransparentPixels": "#fafaf7",
                "gitIgnored": True,
            },
            "smallPreview": {
                "file": small_preview_path.name,
                "maxDimension": 1024,
                "format": "JPEG",
                "gitIgnored": False,
                "use": "审查工作台的轻量预览；不用于测量或坐标反演。",
            },
        }

    document = {
        "schemaVersion": 1,
        "courseId": "jingshanhu",
        "sourceDirectory": source_dir.as_posix(),
        "files": describe_files(source_dir),
        "raster": raster,
        "validation": {
            "embeddedCrsPresent": True,
            "worldFilePixelSizeAndRotationMatch": world["pixelSizeAndRotationMatch"],
            "worldFileMatchesGeoTiffCorner": world["tfwCAndFMatchGeoTiffCorner"],
            "worldFileUsesStandardPixelCenterSemantics": world["standardWorldFilePixelCenterMatch"],
            "rasterAndPrjEpsgMatch": True,
            "pixelToSourceToWgs84AndBackPassed": True,
            "allWgs84CoordinatesInRange": True,
        },
    }
    metadata_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"metadata": metadata_path, "preview": preview_path, "raster": raster}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/raw/jingshanhu_orthophoto_2023"))
    parser.add_argument("--output", type=Path, default=Path("data/derived/jingshanhu"))
    args = parser.parse_args()
    raster_path = args.input if args.input.is_file() else next(args.input.rglob("*.tif"), None)
    if raster_path is None:
        raise FileNotFoundError(f"No .tif found under {args.input}")
    result = prepare(raster_path, raster_path.parent, args.output)
    print(json.dumps({
        "metadata": result["metadata"].as_posix(),
        "preview": result["preview"].as_posix(),
        "width": result["raster"]["width"],
        "height": result["raster"]["height"],
        "epsg": result["raster"]["sourceCrs"]["epsg"],
        "pixelSizeMetres": result["raster"]["pixelSize"],
        "wgs84Bounds": result["raster"]["wgs84Bounds"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

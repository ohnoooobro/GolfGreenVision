"""Boundary tests for the reviewed EPSG:4548 and affine coordinate chain."""

from __future__ import annotations

import importlib.util
import json
import math
import unittest
from pathlib import Path

from affine import Affine
from pyproj import CRS, Transformer


ROOT = Path(__file__).resolve().parents[1]
METADATA_PATH = ROOT / "data/derived/jingshanhu/orthophoto_2023_metadata.json"
SCRIPT_PATH = ROOT / "scripts/prepare_jingshanhu_orthophoto.py"

spec = importlib.util.spec_from_file_location("prepare_jingshanhu_orthophoto", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to import {SCRIPT_PATH}")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

METADATA = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
RASTER = METADATA["raster"]
AFFINE = Affine(*RASTER["affineTransform"])
WIDTH = RASTER["width"]
HEIGHT = RASTER["height"]
TO_SOURCE = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(4548), always_xy=True)
TO_WGS84 = Transformer.from_crs(CRS.from_epsg(4548), CRS.from_epsg(4326), always_xy=True)


class OrthophotoGeometryTests(unittest.TestCase):
    def test_longitude_latitude_axis_order_and_row_column_order(self) -> None:
        upper_left = RASTER["wgs84CornerCoordinates"]["upperLeft"]
        source_x, source_y = TO_SOURCE.transform(*upper_left, errcheck=True)
        column, row = ~AFFINE @ (source_x, source_y)
        self.assertAlmostEqual(column, 0.0, places=5)
        self.assertAlmostEqual(row, 0.0, places=5)

        x0, y0 = prepare.pixel_to_source(AFFINE, 10.0, 20.0)
        x1, y1 = prepare.pixel_to_source(AFFINE, 11.0, 20.0)
        x2, y2 = prepare.pixel_to_source(AFFINE, 10.0, 21.0)
        self.assertAlmostEqual(x1 - x0, AFFINE.a, places=8)
        self.assertAlmostEqual(y2 - y0, AFFINE.e, places=8)
        self.assertLess(y2, y0)

    def test_pixel_corner_and_pixel_center_semantics(self) -> None:
        corner = prepare.pixel_to_source(AFFINE, 0.0, 0.0)
        center = prepare.pixel_to_source(AFFINE, 0.5, 0.5)
        self.assertAlmostEqual(center[0] - corner[0], AFFINE.a / 2, places=8)
        self.assertAlmostEqual(center[1] - corner[1], AFFINE.e / 2, places=8)
        self.assertEqual(RASTER["pixelCoordinateSemantics"], "Continuous pixel-edge coordinates; the center of column c, row r is (c+0.5, r+0.5).")

    def test_known_four_corner_pixel_coordinates(self) -> None:
        expected_pixels = {
            "upperLeft": (0.0, 0.0),
            "upperRight": (float(WIDTH), 0.0),
            "lowerRight": (float(WIDTH), float(HEIGHT)),
            "lowerLeft": (0.0, float(HEIGHT)),
        }
        for name, pixel in expected_pixels.items():
            source = prepare.pixel_to_source(AFFINE, *pixel)
            wgs84 = TO_WGS84.transform(*source, errcheck=True)
            expected = RASTER["wgs84CornerCoordinates"][name]
            self.assertAlmostEqual(wgs84[0], expected[0], places=9, msg=name)
            self.assertAlmostEqual(wgs84[1], expected[1], places=9, msg=name)

    def test_known_center_pixel(self) -> None:
        pixel = tuple(RASTER["pixelCenterSamples"]["imageCenter"]["pixel"])
        source = prepare.pixel_to_source(AFFINE, *pixel)
        expected_source = RASTER["pixelCenterSamples"]["imageCenter"]["source"]
        self.assertAlmostEqual(source[0], expected_source[0], places=7)
        self.assertAlmostEqual(source[1], expected_source[1], places=7)

    def test_wgs84_to_epsg4548_to_pixel_round_trip(self) -> None:
        lonlat = RASTER["pixelCenterSamples"]["imageCenter"]["wgs84"]
        source = TO_SOURCE.transform(*lonlat, errcheck=True)
        pixel = ~AFFINE @ source
        self.assertAlmostEqual(pixel[0], 2926.0, places=3)
        self.assertAlmostEqual(pixel[1], 3031.5, places=3)
        generated = prepare.pixel_to_source(AFFINE, *pixel)
        self.assertLess(math.hypot(generated[0] - source[0], generated[1] - source[1]), 1e-4)

    def test_pixel_to_epsg4548_to_wgs84_round_trip(self) -> None:
        for sample in RASTER["pixelCenterSamples"].values():
            pixel = tuple(sample["pixel"])
            source = prepare.pixel_to_source(AFFINE, *pixel)
            lonlat = TO_WGS84.transform(*source, errcheck=True)
            returned_source = TO_SOURCE.transform(*lonlat, errcheck=True)
            returned_pixel = ~AFFINE @ returned_source
            self.assertLess(math.hypot(returned_pixel[0] - pixel[0], returned_pixel[1] - pixel[1]), 1e-5)


if __name__ == "__main__":
    unittest.main()

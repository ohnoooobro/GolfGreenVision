"""05A GPS 分析脚本的合成数据测试，不读取真实现场轨迹。"""

import unittest
import json
import tempfile
from datetime import timezone
from pathlib import Path

from scripts.analyze_jingshanhu_field import (
    dedupe_records,
    find_near_duplicates,
    flatten_exports,
    invalid_record,
    local_date,
    parse_time,
    validate_export,
    round_stats,
    cross_round_comparison,
    track_support,
    sample_hole_switches,
    geometry_distance_metres,
    verify_private_output,
    projected_crs_match,
    assess_holes,
)


def sample_record(record_id="s-1", timestamp="2026-10-05T16:00:00Z", hole=1, sample_type="tee", **extra):
    value = {
        "id": record_id,
        "sessionId": "synthetic-shared-session",
        "timestamp": timestamp,
        "actualHole": hole,
        "latitude": 40.18,
        "longitude": 116.43,
        "accuracy": 5.0,
        "sampleType": sample_type,
    }
    value.update(extra)
    return value


class TestJingshanhuAnalysis(unittest.TestCase):
    def test_timezone_boundary_uses_shanghai(self):
        self.assertEqual(local_date("2026-10-05T16:00:00Z"), "2026-10-06")
        self.assertEqual(local_date("2026-10-05T15:59:59Z"), "2026-10-05")
        self.assertEqual(parse_time("2026-10-05T16:00:00Z").tzinfo, timezone.utc)

    def test_dedupe_by_record_kind_and_id(self):
        first = sample_record()
        second = dict(first)
        second["latitude"] = 40.181
        kept, duplicates = dedupe_records(
            [{**first, "recordKind": "sample", "sourceFile": "old"}, {**second, "recordKind": "sample", "sourceFile": "new"}]
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0]["reason"], "duplicate-id-content-conflict")

    def test_near_duplicate_requires_same_date_kind_and_sample_type(self):
        a = {**sample_record("a"), "recordKind": "sample", "localDate": "2026-10-06"}
        b = {**sample_record("b", timestamp="2026-10-05T16:00:10Z", latitude=40.18001), "recordKind": "sample", "localDate": "2026-10-06"}
        self.assertEqual(len(find_near_duplicates([a, b])), 1)

    def test_confirmed_and_inherited_are_preserved(self):
        document = {
            "schemaVersion": 1,
            "session": {"sessionId": "synthetic-shared-session"},
            "metadata": {},
            "confirmationEvents": [],
            "track": [],
            "samples": [
                sample_record("confirmed", teeCategory="blue", teeSelectionStatus="confirmed"),
                sample_record("inherited", timestamp="2026-10-05T16:00:10Z", teeCategory="blue", teeSelectionStatus="inherited"),
            ],
        }
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.json"
            path.write_text(__import__("json").dumps(document), encoding="utf-8")
            records, issues, _ = flatten_exports([path])
        self.assertFalse(issues)
        statuses = {item["id"]: item["teeSelectionStatus"] for item in records}
        self.assertEqual(statuses["confirmed"], "confirmed")
        self.assertEqual(statuses["inherited"], "inherited")

    def test_legacy_sample_without_tee_fields_is_unknown(self):
        document = {
            "schemaVersion": 1,
            "session": {"sessionId": "synthetic-shared-session"},
            "metadata": {},
            "confirmationEvents": [],
            "track": [],
            "samples": [sample_record("legacy")],
            "holeTees": {"1": {"teeCategory": "blue", "selectionStatus": "confirmed"}},
        }
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.json"
            path.write_text(__import__("json").dumps(document), encoding="utf-8")
            records, _, _ = flatten_exports([path])
        self.assertEqual(records[0]["teeCategory"], "unknown")
        self.assertEqual(records[0]["teeSelectionStatus"], "unknown")

    def test_missing_hole_and_invalid_gps_are_flagged(self):
        record = {**sample_record(actualHole=99, latitude=200, accuracy=-1), "recordKind": "sample"}
        reasons = invalid_record(record)
        self.assertIn("invalid-hole", reasons)
        self.assertIn("latitude-out-of-range", reasons)
        self.assertIn("invalid-accuracy", reasons)
        self.assertIn("missing-or-invalid-sample-hole", invalid_record({**sample_record(actualHole=None), "recordKind": "sample"}))

    def flatten(self, samples, **extra):
        document = {"schemaVersion": 1, "session": {"sessionId": "synthetic-shared-session"}, "metadata": {}, "samples": samples, **extra}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.json"
            original = json.dumps(document).encode()
            path.write_bytes(original)
            result = flatten_exports([path])
            self.assertEqual(path.read_bytes(), original)
        return result[0]

    def test_same_session_splits_real_dates_and_counts_missing_holes(self):
        records = self.flatten([sample_record("day6"), sample_record("day8", timestamp="2026-10-08T03:00:00Z", hole=2)])
        for date, expected in (("2026-10-06", [1]), ("2026-10-08", [2])):
            subset = [r for r in records if r["localDate"] == date]
            stats, _ = round_stats(subset, {}, {})
            self.assertEqual(stats["coveredHoles"], expected)
            self.assertTrue(stats["holes"][18]["tee"]["missing"])
            self.assertTrue(stats["holes"][18]["green"]["missing"])

    def test_new_export_contains_history_without_double_count(self):
        records = self.flatten([sample_record("history"), sample_record("new", timestamp="2026-10-08T03:00:00Z")])
        old = {**records[0], "sourceFile": "older.json"}
        kept, duplicates = dedupe_records([old, *records])
        self.assertEqual(len(kept), 2)
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(kept[0]["originalId"], "history")
        self.assertEqual(kept[0]["localDate"], "2026-10-06")
        self.assertEqual(set(kept[0]["allSources"]), {"older.json", "synthetic.json"})

    def test_invalid_values_preserved_but_excluded_from_spatial_metrics(self):
        records = self.flatten([sample_record("bad", timestamp="bad-time", latitude=float("nan")), sample_record("good")])
        self.assertIn("invalid-timestamp", records[0]["invalidReasons"])
        self.assertIn("invalid-latitude", records[0]["invalidReasons"])
        self.assertEqual(find_near_duplicates(records), [])
        stats, _ = round_stats(records, {}, {})
        self.assertEqual(stats["sampleCount"], 2)
        self.assertEqual(stats["sampleTrackSupport"][0]["status"], "invalid-position-or-time")

    def test_missing_id_is_not_silently_discarded(self):
        s = sample_record()
        del s["id"]
        records = self.flatten([s])
        kept, _ = dedupe_records(records)
        self.assertEqual(len(kept), 1)
        self.assertIsNone(kept[0]["originalId"])
        self.assertIn("missing-id", kept[0]["invalidReasons"])

    def test_confirmation_event_without_position_dedupes_by_content(self):
        event = {"timestamp": "2026-10-08T03:00:00Z", "predictedHole": 2, "actualHole": "uncertain", "confirmationSource": "user"}
        records = self.flatten([], confirmationEvents=[event, event])
        kept, duplicates = dedupe_records(records)
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(records[0]["invalidReasons"], [])
        self.assertIsNone(records[0]["originalId"])

    def test_near_duplicates_do_not_merge_other_dates_or_sample_types(self):
        records = self.flatten([sample_record("a"), sample_record("b", sample_type="green"), sample_record("c", timestamp="2026-10-08T03:00:00Z")])
        self.assertEqual(find_near_duplicates(records), [])

    def test_cross_round_conflict_is_retained_without_guessing_missing_holes(self):
        records = self.flatten([sample_record("a"), sample_record("b", timestamp="2026-10-08T03:00:00Z", latitude=40.19)])
        rows = cross_round_comparison(records)
        self.assertEqual(rows[0]["status"], "separated")
        self.assertEqual(rows[1]["status"], "missing-one-or-both-days")

    def test_shared_fix_is_not_independent_track_evidence(self):
        sample = sample_record()
        self.assertEqual(track_support([sample], [dict(sample)])[0]["status"], "shared-fix-only")
        later = {**sample, "timestamp": "2026-10-05T16:00:10Z"}
        self.assertEqual(track_support([sample], [later])[0]["status"], "separate-fix-nearby")
        self.assertEqual(track_support([sample], [])[0]["status"], "no-track-within-60s")

    def test_same_fix_across_hole_labels_is_flagged(self):
        samples = [sample_record("a"), sample_record("b", hole=2)]
        flags = sample_hole_switches(samples)
        self.assertEqual(len(flags), 1)
        self.assertTrue(flags[0]["sameFix"])

    def test_polygon_holes_and_corridor_line_distances(self):
        outer = [[116.429, 40.179], [116.431, 40.179], [116.431, 40.181], [116.429, 40.181], [116.429, 40.179]]
        inner = [[116.4299, 40.1799], [116.4301, 40.1799], [116.4301, 40.1801], [116.4299, 40.1801], [116.4299, 40.1799]]
        point = sample_record()
        self.assertEqual(geometry_distance_metres(point, {"geometry": {"type": "Polygon", "coordinates": [outer]}}), 0)
        self.assertGreater(geometry_distance_metres(point, {"geometry": {"type": "Polygon", "coordinates": [outer, inner]}}), 8)
        self.assertAlmostEqual(geometry_distance_metres(point, {"geometry": {"type": "LineString", "coordinates": [[116.43, 40.179], [116.43, 40.181]]}}), 0, delta=0.01)

    def test_public_output_path_is_rejected(self):
        with self.assertRaises(ValueError):
            verify_private_output(Path("docs/private-gps"))

    def test_bad_export_shape_fails_clearly(self):
        issues = validate_export({"schemaVersion": 1, "samples": "invalid", "session": None}, Path("synthetic.json"))
        self.assertTrue(any("不是数组" in message for message in issues))
        with self.assertRaises(ValueError):
            self.flatten([], track="invalid")

    def test_crs_comparison_ignores_esri_axis_names_but_not_projection(self):
        from pyproj import CRS

        epsg = CRS.from_epsg(4548)
        esri = CRS.from_wkt(epsg.to_wkt(version="WKT1_ESRI"))
        self.assertTrue(projected_crs_match(epsg, esri))
        self.assertFalse(projected_crs_match(epsg, CRS.from_epsg(4547)))
        self.assertFalse(projected_crs_match(epsg, CRS.from_epsg(4326)))

    def test_duplicate_content_change_beyond_position_is_not_silent(self):
        records = self.flatten([sample_record("same", speed=0), sample_record("same", speed=3)])
        kept, duplicates = dedupe_records(records)
        self.assertEqual(len(kept), 1)
        self.assertEqual(duplicates[0]["reason"], "duplicate-id-content-conflict")
        self.assertIn("original-content", duplicates[0]["conflictingFields"])

    def test_invalid_positions_cannot_be_strong_candidates(self):
        records = self.flatten([sample_record("tee", latitude=200), sample_record("green", sample_type="green", latitude=200)])
        stats, _ = round_stats(records, {}, {})
        assessment = assess_holes({"2026-10-08": stats}, {})[0]
        self.assertEqual(assessment["status"], "conflicting")
        self.assertIsNone(assessment["suggestedReviewObjects"]["tee"])
        self.assertIsNone(assessment["suggestedReviewObjects"]["green"])

    def test_malformed_candidate_mapping_fails_clearly(self):
        with self.assertRaisesRegex(ValueError, "candidateMapping"):
            self.flatten([sample_record(candidateMapping="invalid")])


if __name__ == "__main__":
    unittest.main()

"""Reproduce controlled-semantics real photos, without VLM calls or GT fitting.

RulerNet must be configured as for the measurement service. The manifest's
hashes pin the three previously used original product photographs. Ground
truth and old measurements enter reporting only, never geometry selection.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'measurement-service'))
from app import measure_rgb
from geometry_executor import _select_object_contour
from thread_geometry import (
    detect_threaded_shank, _detect_threaded_shank_global,
    detect_local_shank_regime, decompose_head_body,
)
from rulernet import infer_ruler, local_px_per_cm
from scale_reference import resolve_scale_reference
from geometry import extract_object_geometry


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--images', type=Path, required=True, help='Cached original photo directory')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.images.mkdir(parents=True, exist_ok=True)
    cases = json.loads(Path(__file__).with_name('cases.json').read_text())
    records = []
    for case in cases:
        path = args.images / (case['case'] + '-original.jpg')
        if not path.exists():
            request = urllib.request.Request(case['image_url'], headers={'User-Agent': 'HCSI validation'})
            with urllib.request.urlopen(request, timeout=60) as response:
                path.write_bytes(response.read())
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if sha != case['sha256']:
            raise ValueError(f"{case['case']}: original image hash changed; inspect before testing")
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f'{path}: invalid image')
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = measure_rgb(rgb, sha, case['steps'], case['semantic_input'])
        scale = resolve_scale_reference(rgb, infer_ruler(rgb))
        structure = None
        frame_comparison = None
        if scale.px_per_cm is not None:
            geo = extract_object_geometry(rgb, scale.reference_points_px, scale.px_per_cm,
                                          scale.direction_xy, semantic_vision=case['semantic_input'])
            effective = scale.px_per_cm
            if scale.source in {'rulernet_cm', 'rulernet_cm+imperial_ticks'} and geo.center_xy:
                effective = local_px_per_cm(scale.reference_points_px, geo.center_xy) or effective
            contour = _select_object_contour(rgb, scale.reference_points_px, effective, case['semantic_input'])
            def frame_record(p):
                if p is None: return None
                s = decompose_head_body(p)
                return dict(
                    axis=p.axis.tolist(), tip_s=p.tip_s,
                    transition_s=p.transition_s,
                    shank_span_px=abs(p.tip_s-p.transition_s),
                    transition_start_s=s.transition_start_s,
                    bearing_plane_s=None if s.bearing_plane is None else s.bearing_plane.s,
                    reason=s.reason_code,
                )
            legacy = None if contour is None else _detect_threaded_shank_global(contour)
            local = None if contour is None else detect_local_shank_regime(contour)
            profile = None if contour is None else detect_threaded_shank(contour)
            frame_comparison = {
                'legacy': frame_record(legacy),
                'local': frame_record(local),
                'selected': frame_record(profile),
            }
            if profile is not None:
                structure = dataclasses.asdict(decompose_head_body(profile))
        steps = result['geometry_steps']
        values = {s['purpose']: s['value_mm'] for s in steps}
        # Regressions protect independent D/P. L is deliberately re-evaluated,
        # not snapped to a nominal size or compared only by nearest size.
        for dimension in ('D', 'P'):
            if values[dimension] != case['baseline'][dimension]:
                raise AssertionError(f"{case['case']}: {dimension} changed: {values}")
        errors = {d: None if v is None else round(100 * (v / case['ground_truth'][d + '_mm'] - 1), 3)
                  for d, v in values.items()}
        record = dict(case=case['case'], source=case['source'], image_url=case['image_url'],
                      sha256=sha, ground_truth=case['ground_truth'], baseline=case['baseline'],
                      values_mm=values, errors_pct=errors, structure=structure,
                      frame_comparison=frame_comparison, controlled_semantics=True, api_calls=0, result=result)
        records.append(record)
        print(json.dumps({k: record[k] for k in (
            'case', 'values_mm', 'errors_pct', 'frame_comparison'
        )}, ensure_ascii=False))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()

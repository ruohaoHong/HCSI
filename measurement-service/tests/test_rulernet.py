import pathlib
import sys

import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from rulernet import (  # noqa: E402
    PreprocessTransform,
    local_px_per_cm,
    map_marks_to_original,
    median_px_per_cm,
    perspective_step_pct,
    reconstruct_processed_marks,
)


def test_reconstruct_constant_spacing_marks():
    points = reconstruct_processed_marks(
        initial_point=np.array([384.0, 384.0]),
        dist=50.0,
        ratio=1.0,
        direction=np.array([1.0, 0.0]),
        points_info=np.array([3.0, 200.0, 300.0, 600.0, 460.0]),
    )
    assert len(points) >= 4
    spacings = np.linalg.norm(np.diff(points, axis=0), axis=1)
    assert np.allclose(spacings, 50.0)


def test_map_marks_back_to_original_and_scale():
    transform = PreprocessTransform(scale=0.5, top=100, left=50, original_height=1000, original_width=1200)
    processed = np.array([[100.0, 200.0], [125.0, 200.0], [150.0, 200.0]])
    original = map_marks_to_original(processed, transform)
    assert np.allclose(original, [[100, 200], [150, 200], [200, 200]])
    assert median_px_per_cm(original) == 50.0


def test_local_scale_uses_nearest_segments():
    points = np.array([[0.0, 0.0], [40.0, 0.0], [82.0, 0.0], [126.0, 0.0], [172.0, 0.0]])
    scale = local_px_per_cm(points, (130.0, 60.0))
    assert scale == 44.0


def test_perspective_metric_is_orientation_invariant():
    assert round(perspective_step_pct(1.04), 3) == 4.0
    assert round(perspective_step_pct(1 / 1.04), 3) == 4.0

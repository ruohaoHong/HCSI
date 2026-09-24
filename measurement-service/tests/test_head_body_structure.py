"""Analytical geometry tests, not substitutes for photographic acceptance.

Known datums are constructed before measurement and never fed into the model.
"""
import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from thread_geometry import detect_threaded_shank, decompose_head_body


def fastener_contour(crown, fillet, scale=1.0, angle=0.0, reverse=False):
    bearing = 300.0 + fillet
    x = np.arange(0.0, bearing + 36.0, 0.25)
    radius = np.full_like(x, 16.0)
    neck = (x > 300.0) & (x < bearing)
    radius[neck] = 16.0 + fillet - np.sqrt(np.maximum(0.0, fillet**2 - (x[neck] - 300.0)**2))
    head = x >= bearing
    z = (x[head] - bearing) / 35.0
    if crown == 'round':
        radius[head] = 40.0 * np.sqrt(np.maximum(0.0, 1.0 - z**2))
    elif crown == 'chamfered':
        radius[head] = 40.0 - 12.0 * np.maximum(0.0, (z - 0.65) / 0.35)
    else:
        radius[head] = 40.0
    points = np.vstack((np.column_stack((x, -radius)),
                        np.column_stack((x[::-1], radius[::-1]))))
    rotation = np.array([[np.cos(angle), -np.sin(angle)],
                         [np.sin(angle), np.cos(angle)]])
    if reverse:
        points[:, 0] *= -1
    points = points @ rotation.T * scale + [1000.0, 1000.0]
    return np.rint(points).astype(np.int32).reshape(-1, 1, 2), bearing * scale


@pytest.mark.parametrize('crown', ['round', 'chamfered', 'square'])
@pytest.mark.parametrize('fillet', [0.0, 4.0, 12.0])
def test_bearing_plane_is_independent_of_crown_and_fillet(crown, fillet):
    contour, truth = fastener_contour(crown, fillet)
    profile = detect_threaded_shank(contour)
    assert profile is not None
    structure = decompose_head_body(profile)
    assert structure.bearing_plane is not None, structure
    measured = abs(structure.bearing_plane.s - structure.tip_s)
    assert abs(measured - truth) <= 2.0
    if fillet == 12.0:
        assert abs(structure.bearing_plane.s - structure.transition_start_s) > 3.0


@pytest.mark.parametrize('scale,angle,reverse', [(0.75, 0.0, True), (2.0, 0.0, False),
                                               (1.0, 0.12, False), (1.5, -0.12, True)])
def test_structure_transforms_with_object(scale, angle, reverse):
    contour, truth = fastener_contour('round', 12.0, scale, angle, reverse)
    profile = detect_threaded_shank(contour)
    assert profile is not None
    structure = decompose_head_body(profile)
    assert structure.bearing_plane is not None, structure
    assert abs(abs(structure.bearing_plane.s - structure.tip_s) - truth) <= 3.0


def test_conical_transition_is_not_a_perpendicular_bearing_face():
    points = np.array([[0, -16], [300, -16], [324, -40], [335, -40],
                       [335, 40], [324, 40], [300, 16], [0, 16]], np.int32)
    profile = detect_threaded_shank((points + 500).reshape(-1, 1, 2))
    assert profile is not None
    structure = decompose_head_body(profile)
    assert structure.transition_start_s is not None
    assert structure.bearing_plane is None
    assert structure.reason_code == 'bearing_plane_unresolved'


def test_disagreeing_shoulders_are_not_averaged_into_a_plane():
    points = np.array([[0, -16], [300, -16], [300, -40], [370, -40],
                       [370, 40], [330, 40], [330, 16], [0, 16]], np.int32)
    profile = detect_threaded_shank((points + 500).reshape(-1, 1, 2))
    assert profile is not None
    assert decompose_head_body(profile).bearing_plane is None


def test_smooth_curved_projection_is_not_extrapolated_to_hidden_plane():
    # A smooth widening underside can be accurately segmented but still does
    # not expose a planar length datum. A model must not use its neck onset.
    r = np.linspace(16, 40, 100)
    x = 300 + 0.3 * (r - 16) + 0.008 * (r - 16)**2
    points = np.vstack(([[0, -16]], np.column_stack((x, -r)),
                        [[350, -40], [350, 40]], np.column_stack((x[::-1], r[::-1])),
                        [[0, 16]]))
    profile = detect_threaded_shank(np.rint(points + 500).astype(np.int32).reshape(-1, 1, 2))
    assert profile is not None
    structure = decompose_head_body(profile)
    assert structure.transition_start_s is not None
    assert structure.bearing_plane is None


def test_insufficient_first_shoulder_cannot_be_replaced_by_later_head_step():
    points = np.array([[0, -40], [300, -40], [300, -48], [330, -48],
                       [330, -90], [390, -90], [390, 90], [330, 90],
                       [330, 48], [300, 48], [300, 40], [0, 40]], np.int32)
    profile = detect_threaded_shank((points + 500).reshape(-1, 1, 2))
    assert profile is not None
    structure = decompose_head_body(profile)
    assert structure.bearing_plane is None
    assert structure.reason_code == 'bearing_plane_support_insufficient'

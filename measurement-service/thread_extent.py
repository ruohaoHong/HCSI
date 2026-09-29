"""Infer the physical extent of visible threads, independent of the pitch ROI.

P uses a deliberately trimmed stable region. B must instead interrogate the
entire visible shaft from the observed bearing plane toward the physical tip,
including smooth portions. No catalogue dimensions or GT enter this module.

A thread is a spatially *persistent* periodic edge relief, not merely a narrow
cylinder. The algorithm detects its boundaries using optical-quality-gated,
sliding multi-cycle windows. If either physical endpoint is unobservable it
returns no B, with a specific reason and image-derived diagnostics.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

import numpy as np

from edge_observation import EdgeTrack, observe_thread_edges
from thread_geometry import HeadUnderfaceEstimate, ThreadedShankProfile


@dataclass(frozen=True)
class ThreadExtent:
    value_px: float | None
    start_s: float | None
    end_s: float | None
    reason: str | None
    diagnostics: dict[str, float | int | str | bool]


def _window_evidence(
    s: np.ndarray,
    radii: np.ndarray,
    valid: np.ndarray,
    uncertainty: np.ndarray,
    pitch: float,
    center: float,
    half_span: float,
    *,
    min_cycles: float = 2.0,
) -> tuple[bool | None, float]:
    """Return True/False only when the local raw edge can be observed.

    We fit the sinusoidal component at the *measured image-space pitch*, while
    marginalizing both intercept and slow shaft taper. An unseen or blurred
    window is unknown, not evidence for a smooth/unthreaded section.
    """
    region = (s >= center - half_span) & (s <= center + half_span)
    indices = np.flatnonzero(region)
    if len(indices) < max(8, int(round(min_cycles * pitch))):
        return None, 0.0
    indices = indices[np.isfinite(radii[indices]) | ~valid[indices]]
    if len(indices) < max(8, int(round(min_cycles * pitch))):
        return None, 0.0
    ok = valid[indices] & np.isfinite(radii[indices]) & np.isfinite(uncertainty[indices])
    if float(np.mean(ok)) < 0.72:
        return None, 0.0
    local_s = s[indices]
    if np.max(np.diff(local_s)) > 2.0:
        return None, 0.0
    observed = np.flatnonzero(ok)
    if np.max(np.diff(observed)) > max(3, int(round(0.40 * pitch))):
        return None, 0.0
    vals = np.interp(local_s, local_s[observed], radii[indices][observed])
    center_s = local_s - float(np.mean(local_s))
    omega = 2.0 * np.pi / pitch
    design = np.column_stack([
        np.sin(omega * center_s),
        np.cos(omega * center_s),
        np.ones(len(center_s)),
        center_s,
    ])
    try:
        coeffs, _, _, _ = np.linalg.lstsq(design, vals, rcond=None)
    except np.linalg.LinAlgError:
        return None, 0.0
    amp = float(np.hypot(coeffs[0], coeffs[1]))
    detrended = vals - (coeffs[2] + coeffs[3] * center_s)
    power = float(np.mean(detrended ** 2))
    coherence = float(amp ** 2 / max(2.0 * power, 1e-6))
    optical_floor = float(np.median(uncertainty[indices][ok]))
    # This is an observable relief threshold, not a nominal thread-depth
    # table. Below the optical edge-localization floor, B is not observable.
    relief_detectable = amp >= max(0.85, 2.6 * optical_floor)
    return relief_detectable and coherence >= 0.45, coherence


def _measure_window(
    tracks: tuple[EdgeTrack, EdgeTrack],
    pitch: float,
    center: float,
    half_span: float,
) -> tuple[bool | None, float]:
    decisions = [
        _window_evidence(
            track.s_px, track.outward_px, track.valid,
            track.uncertainty_px, pitch, center, half_span,
            min_cycles=1.6 if half_span < 1.4 * pitch else 2.0,
        )
        for track in tracks
    ]
    supported = [decision for decision, _ in decisions if decision is not None]
    if not supported:
        return None, 0.0
    # A single trustworthy flank is admissible only as local presence evidence,
    # not as proof that the opposite side has the same distal boundary.
    if len(supported) == 2 and supported[0] != supported[1]:
        return None, 0.0
    return supported[0], max(score for _, score in decisions)


def _evidence_runs(
    centers: np.ndarray, decisions: list[bool | None], pitch: float
) -> list[np.ndarray]:
    """Bridge brief unobservable optical gaps, NEVER observed smooth shaft.

    Missing edge observations cannot be treated as a measured interruption of
    physical thread. A long blind gap remains unresolvable, however, even when
    the sections on either side share the same pitch.
    """
    active = np.flatnonzero(np.asarray([value is True for value in decisions]))
    if not len(active):
        return []
    groups: list[list[int]] = [[int(active[0])]]
    for next_idx in active[1:]:
        prev_idx = groups[-1][-1]
        gap = float(centers[next_idx] - centers[prev_idx])
        between = decisions[prev_idx + 1:int(next_idx)]
        if gap <= 1.45 * pitch and all(item is None for item in between):
            groups[-1].append(int(next_idx))
        else:
            groups.append([int(next_idx)])
    return [np.asarray(group, dtype=np.int32) for group in groups]


def infer_thread_extent(
    image_rgb: np.ndarray,
    profile: ThreadedShankProfile,
    bearing: HeadUnderfaceEstimate | None,
    pitch_px: float,
) -> ThreadExtent:
    """Measure B only if the image shows both physical thread-end conditions.

    The method supports fully threaded and partially threaded screws without
    assuming either. Distances are returned along the fitted screw axis.
    """
    diagnostics: dict[str, float | int | str | bool] = {
        "method": "raw_edge_local_periodicity_change_point",
        "pitch_basis_px": round(float(pitch_px), 3) if np.isfinite(pitch_px) else 0.0,
    }
    if bearing is None:
        return ThreadExtent(None, None, None, "head_bearing_plane_unresolved", diagnostics)
    if not np.isfinite(pitch_px) or pitch_px < 3.0:
        return ThreadExtent(None, None, None, "thread_pitch_unreliable_for_extent", diagnostics)
    tip_dir = 1.0 if profile.tip_s > profile.transition_s else -1.0
    shaft_length = (profile.tip_s - bearing.s) * tip_dir
    if shaft_length < 6.5 * pitch_px:
        return ThreadExtent(None, None, None, "too_few_thread_cycles_to_resolve_extent", diagnostics)

    # Extend the P profile back to both physical termini. The guard is based
    # only on optical edge geometry, not a percentage of screw length.
    coordinate = (profile.s_values - bearing.s) * tip_dir
    guard = max(1.5, min(3.0, 0.20 * pitch_px))
    full_mask = (coordinate >= guard) & (coordinate <= shaft_length - guard)
    if np.count_nonzero(full_mask) < 6 * pitch_px:
        return ThreadExtent(None, None, None, "visible_shank_span_too_short", diagnostics)
    expanded = replace(profile, sample_mask=full_mask)
    top, bottom = observe_thread_edges(image_rgb, expanded)
    # Work head-to-tip regardless of principal-axis sign.
    norm_s = (top.s_px - bearing.s) * tip_dir
    order = np.argsort(norm_s)
    tracks = tuple(
        replace(
            track,
            s_px=(track.s_px - bearing.s)[order] * tip_dir,
            outward_px=track.outward_px[order],
            valid=track.valid[order],
            uncertainty_px=track.uncertainty_px[order],
        )
        for track in (top, bottom)
    )
    span = 1.5 * pitch_px
    stride = max(2.0, 0.40 * pitch_px)
    centers = np.arange(guard + span, shaft_length - guard - span + 0.1, stride)
    if len(centers) < 4:
        return ThreadExtent(None, None, None, "thread_local_windows_insufficient", diagnostics)
    window = [_measure_window(tracks, pitch_px, c, span) for c in centers]
    state = np.array([x[0] == True for x in window], dtype=bool)
    observable = np.array([x[0] is not None for x in window], dtype=bool)
    diagnostics["windows_total"] = len(window)
    diagnostics["windows_observable"] = int(np.sum(observable))
    diagnostics["windows_threaded"] = int(np.sum(state))
    if np.sum(state) < 3:
        return ThreadExtent(None, None, None, "continuous_thread_relief_not_detected", diagnostics)

    # A disjoint periodic island is not a unique B; do not choose the longest
    # island when another sufficiently long run is visible.
    decisions = [item[0] for item in window]
    diagnostics["windows_unknown"] = int(sum(v is None for v in decisions))
    runs = [group for group in _evidence_runs(centers, decisions, pitch_px)
            if len(group) >= 2]
    if not runs:
        return ThreadExtent(None, None, None, "thread_interval_not_continuous", diagnostics)
    runs.sort(key=len, reverse=True)
    run = runs[0]
    if len(runs) > 1 and len(runs[1]) >= max(3, int(0.40 * len(run))):
        # A second cluster without *observed smooth shaft* between it and
        # the first cluster is missing optical evidence, not physical proof
        # of separated thread sections.
        runnerup = runs[1]
        earlier, later = sorted((run, runnerup), key=lambda group: int(group[0]))
        separator = decisions[int(earlier[-1]) + 1:int(later[0])]
        reason = (
            "thread_interval_disconnected_by_unobservable_edges"
            if separator and all(item is None for item in separator)
            else "multiple_disjoint_thread_intervals"
        )
        return ThreadExtent(None, None, None, reason, diagnostics)
    first, last = int(run[0]), int(run[-1])
    if (centers[last] - centers[first]) < 3.0 * pitch_px:
        return ThreadExtent(None, None, None, "insufficient_continuous_thread_cycles", diagnostics)
    diagnostics["threaded_window_span_px"] = round(float(centers[last] - centers[first]), 3)

    # A visible physical tip is an actual B endpoint only when periodic relief
    # persists into a probe adjacent to it. Absence of evidence is not a proof
    # that thread continues all the way to the tip.
    near_tip = shaft_length - guard - pitch_px
    tip_supported, tip_score = _measure_window(tracks, pitch_px, near_tip, 0.95 * pitch_px)
    diagnostics["tip_probe_observed"] = tip_supported is not None
    diagnostics["tip_probe_coherence"] = round(tip_score, 3)
    if tip_supported is not True or shaft_length - centers[last] > 2.8 * pitch_px:
        return ThreadExtent(None, None, None, "thread_tip_boundary_unresolved", diagnostics)

    # Full thread: independently look for actual periodic relief immediately
    # adjacent to the bearing plane. Do NOT infer full thread merely because
    # an interior P was found.
    near_head = guard + pitch_px
    head_supported, head_score = _measure_window(tracks, pitch_px, near_head, 0.95 * pitch_px)
    diagnostics["head_probe_observed"] = head_supported is not None
    diagnostics["head_probe_coherence"] = round(head_score, 3)
    if head_supported is True and centers[first] - guard <= 2.8 * pitch_px:
        start = 0.0
        coverage = "head_to_tip_visible_full_thread"
        start_uncertainty = pitch_px
    else:
        # Partial thread: require the near-head smooth segment AND an observable
        # change point separating it from the continuous periodic region.
        before = np.arange(first)
        smooth = before[observable[before] & ~state[before]]
        if not len(smooth):
            return ThreadExtent(None, None, None, "thread_head_boundary_unresolved", diagnostics)
        quiet = int(smooth[-1])
        # Optical uncertainty at a physical smooth-to-thread change point
        # can make one or two overlapping windows unclassifiable. Bracket the
        # boundary between the *observed* last-smooth and first-periodic
        # windows, but refuse a gap wider than a physical pitch.
        uncertain_gap = float(centers[first] - centers[quiet])
        diagnostics["onset_observation_bracket_px"] = round(uncertain_gap, 3)
        if (uncertain_gap > 1.25 * pitch_px
                or np.any(observable[quiet + 1:first])):
            return ThreadExtent(None, None, None, "thread_start_transition_occluded", diagnostics)
        if centers[quiet] < guard + 2.0 * pitch_px:
            return ThreadExtent(None, None, None, "near_head_thread_start_ambiguous", diagnostics)
        start = float((centers[quiet] + centers[first]) * 0.5)
        start_uncertainty = max(pitch_px, (centers[first] - centers[quiet]) * 0.5 + pitch_px * 0.5)
        coverage = "observed_smooth_to_thread_transition"
    diagnostics["coverage"] = coverage
    diagnostics["start_boundary_uncertainty_px"] = round(float(start_uncertainty), 3)
    diagnostics["end_boundary_uncertainty_px"] = round(float(pitch_px), 3)
    length = shaft_length - start
    if length < 3.0 * pitch_px:
        return ThreadExtent(None, None, None, "thread_extent_too_short", diagnostics)
    start_s = bearing.s + tip_dir * start
    return ThreadExtent(
        round(float(length), 3),
        round(float(start_s), 3),
        round(float(profile.tip_s), 3),
        None,
        diagnostics,
    )

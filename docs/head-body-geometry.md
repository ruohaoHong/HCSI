# Common head/body geometry (experimental)

A head/body partition and a nominal-length datum are different observations.
The old primitive equated the first persistent departure from the shaft
width with the under-head bearing plane. A fillet can move that departure
without moving the actual seating face.

This branch introduces `HeadBodyStructure`: a shared shaft coordinate frame,
tip, outer head endpoint, transition onset, and an optional observed bearing
plane. Crown shape and catalog dimensions do not enter the estimator. The
existing threaded-shank sample remains unchanged for D/P.

## Geometry and acceptance

1. Preserve the existing stable shaft envelope and head direction.
2. Keep first expansion as a *transition-region boundary*, never as the L datum.
3. Trace the head-facing silhouette at increasing radius on each side of the
   shaft. This represents a vertical shoulder directly, unlike a width change.
4. Seek the first bilateral, near-perpendicular shoulder over overlapping
   radial intervals. Require small slope, fit residual and side disagreement.
5. Refuse insufficient, contradictory or curved evidence. Do not extrapolate
   a hidden face, snap to a nominal length, or fall back to first expansion.
6. Flat-countersunk overall length retains its separate endpoint convention.
   The executor now obtains its axis and endpoints from the same shaft profile.

The first short shoulder cannot be replaced by a more prominent later head
step. Rejection is local to under-head L; D/P can remain measured. Existing
response semantics require consumers to check each geometry step's status;
the overall contour-valid flag is not an exact-spec acceptance flag.

The numeric tolerances are engineering choices for approximately side-on
images: segment slope <= 0.15 axial/radial, residual <= max(1 px, 0.015 D),
bilateral disagreement <= max(2 px, 0.04 D), and shared radial span >=
max(6 px, 0.20 D). They are not validated measurement uncertainty bounds.
A 3 px seed detects undersupported early shoulders before broader later steps.

## Scope and limits

Analytical geometry tests cover square, rounded and chamfered crowns; zero,
small and large neck fillets; scale, reversal and modest image-plane rotation;
conical transitions, disagreeing shoulders, curved projections and undersized
first shoulders. These numeric fixtures are not photographic acceptance data.

This is not a universal reconstruction of arbitrary screws. Occlusion,
out-of-plane tilt, a curved visible projection, washers, captive assemblies,
raised countersunk datums, short/wide parts, and multiple target objects need
additional evidence or explicitly different supported geometry. The original
shaft detector still assumes a sufficiently long, narrow side next to a wider
head. A fitted silhouette face does not prove nominal manufacturing dimensions.

The datum distinction is consistent with ISO 888:2012 section 4.2: protruding
heads use the bearing face; flat countersunk heads use the upper head edge;
raised countersunk heads have a different theoretical reference. That document
covers ISO metric threads; it is not a dimensional authority for NAS220-6.
Source: https://preview.sist.si/sist-preview/50946/fee9720502744f54875f20faf25bcf60/ISO-888-2012.pdf

## Reproduction

Baseline: `124da4469366bc28a4539e9e8d883ad34f881c9d`.

```bash
python -m pytest -q measurement-service/tests
RULERNET_MODEL_PATH=/path/to/model.onnx python benchmark/head-body-validation/run.py \
  --images /path/to/originals --output /path/to/head-body-real-cases.json
```

`benchmark/head-body-validation/cases.json` pins the previously used real
photographs by SHA-256, source URLs, ground truth, and coarse semantic inputs.
No VLM/API calls are used. Ground truth is used only to score results after
measurement. The runner asserts that D/P remain identical to baseline. It
records L accuracy even when worse, and treats unresolved L as missing.

The checked-in validation result is the controlled-semantics production
measurement pipeline, not a live semantic-planner end-to-end acceptance test.
Do not promote this experimental branch solely because its unit tests pass.

## Validation on the pinned originals

| Case | Ground truth L (mm) | Baseline L | New L | Interpretation |
| --- | ---: | ---: | ---: | --- |
| B, flat countersunk | 40.000 | 40.39 | 40.39 | Overall-length convention retained |
| C, hex | 45.000 | 46.52 | 47.00 | Observable shoulder, but nominal error worsened |
| D, pan | 10.31875 | 9.76 | unresolved | No supported planar shoulder in the visible contour |

D/P are unchanged for all three. All three scale and contour gates remain
valid; D's L step now explicitly reports `bearing_plane_unresolved`. This does
not establish that its earlier error was caused only by a fillet. Neither the
new nor the old results isolate perspective, actual part tolerance and true
3D bearing location from this single photo.

70 Python tests pass (53 existing plus 17 structural tests). The common model
is implemented and reproducible, but the real photographs do **not** support
claiming a general accuracy improvement or promoting it over the previous
work branch. Keep the branch experimental. The next discriminating evidence
is an independently measured, side-on protruding-head photo with a visible
bearing face and a ruler in the same plane; do not adjust offsets to make D's
nominal length match.

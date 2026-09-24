# Under-head L experiment: accepted 124da baseline

Starting point: `feature/semantic-pixel-ownership` at
`124da4469366bc28a4539e9e8d883ad34f881c9d`.

The earlier `feature/common-head-body-geometry` branch was NOT used as this
experiment's base. In particular, its new global frame and replacement L
estimator are not allowed to affect the accepted measurements.

## Scope and falsifiable hypothesis

The working hypothesis is that the original under-head primitive conflates
the first persistent departure from the stable local shank width with the
bearing plane of a curved protruding head. The local width regime provides
an *onset*, not necessarily the physical length datum.

`measurement-service/head_bearing_assist.py` is opt-in, receives the accepted
`ThreadedShankProfile`, and searches for bilateral near-perpendicular
silhouette shoulder evidence. It does not change the ruler, object contour,
shank axis, D/P, or the accepted L value. A missing observed face is reported
as `bearing_plane_unresolved`; no calibration offset or catalog-length snap
is permitted.

The B/C/D manifest uses SHA-256-pinned, unmodified original photographs and
the same controlled semantic inputs from the accepted work. Ground truth is
catalog *nominal* information, not an independent caliper measurement of the
individual pictured fastener.

## Real-photo ablation (unchanged production outputs)

CI run: https://github.com/ruohaoHong/HCSI/actions/runs/36047639136

| Case | Accepted L (mm) | Optional observed-face L (mm) | Status |
| ---- | --------------: | -----------------------------: | ------ |
| B, flat countersunk | 40.39 | unresolved | This head's reference is `head_top`, not an underface datum. |
| C, hex | 46.52 | 46.997 | Visible bilateral shoulder, but farther from nominal 45 mm. |
| D, pan | 9.76 | unresolved | First expansion known, no sufficiently supported visible planar bearing face. |

D/P remain exactly the previously accepted results in all three cases. The
B/C/D test runner asserts that all existing D/P/L outputs equal the 124da
baseline; the auxiliary evidence cannot silently replace their dimensions.

58 unit tests pass (53 baseline + 5 new shape tests). Their synthetic geometry
only validates the mechanics of shoulder recognition; it is not real-photo
accuracy evidence.

## Decision

Do not merge the optional estimator into production L. This experiment
confirms the distinction between a local scale change and a bearing plane,
but does not prove that D's -5.4% nominal residual comes from the head datum.
C shows that a geometrically observable alternative datum can even move
the estimate away from catalog nominal length.

Next discriminating input: a real photo with a visible and independently
measured under-head bearing face, ruler coplanar with the screw, and enough
information to separate perspective and actual manufacturing variation.
Avoid using the nominal catalog length as a pixel-level training target.

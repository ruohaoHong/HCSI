# Local shaft-width regime: results and release boundary

This experiment recovers a shaft/head coordinate frame from a **persistent local
width regime change**, not whole-object PCA aspect ratio. The transition is a
**region boundary**, not the under-head length datum. No catalog size or
ground truth is used by the estimator.

## Verified run

Workflow: https://github.com/ruohaoHong/HCSI/actions/runs/36044653686
Artifact: https://github.com/ruohaoHong/HCSI/actions/runs/36044653686/artifacts/10827479276
Pinned B/C/D image SHA-256 values are in
`benchmark/head-body-validation/cases.json`; the workflow restores images
from prior accepted run artifacts and verifies their hashes before scoring.

- 77 Python tests passed (70 existing and 7 local-regime tests).
- B (flat): D 5.96 mm, P 1.015 mm, L 40.39 mm.
  Local regime deliberately unresolved; established shaft geometry retained.
- C (hex): D 14.23 mm, P 2.015 mm, L 47.00 mm using experimental
  visible-bearing model; the previous production L was 46.52 mm. The local
  frame exists but its shoulder is not sufficiently supported, so the
  established frame is retained.
- D (pan): D 4.18 mm, P 0.774 mm, L not measured:
  `bearing_plane_unresolved`. A local frame exists, but does not establish
  a visible bearing plane. These are catalog nominal comparisons, not measured
  physical-part ground truth.

## Independent short/wide real-photo discriminator

MS35207-279 original image was processed with **ruler-only controlled
calibration**, 17 consecutive 1/16-inch tick marks across 435.5 px. Production
automatic scale inference still reports `scale_unit_unconfirmed` for this
photograph, so this is **not end-to-end validation**.

The global contour PCA axis is approximately (0.976, 0.217). The local
width-regime axis is approximately (0.990, 0.139). It detects a first expansion
region 194 px from the tip (11.31 mm at controlled ruler scale), without using
nominal dimensions. The actual under-head bearing plane remains
`bearing_plane_unresolved`.

Crucially, running D/P/L in the controlled path additionally exposes a
**measurement failure**:

- D = **7.97 mm**, substantially different from the catalog nominal
  1/4 inch = 6.35 mm. The nominal diameter is not a physical ground-truth
  caliper reading, but a 25% discrepancy clearly prevents acceptance.
- P = `not_measured / periodicity_signal_weak`.
- L = `not_measured / bearing_plane_unresolved`.

The image contains visible shadows adjacent to the screw; the selected
appearance contour may include non-object pixels. The diagnostic does not
establish whether all excess width is shadow or local-axis misalignment.
The geometry gate was `contour_reliable=true`, which is **not** sufficient
evidence of accurate D/P/L. Do not label this real photo as passed based only
on successful frame detection or a green workflow.

## Conclusions for the product

The local-width principle has passed a limited **structural proof of concept**:
short/wide synthetic screws with rotation/reversal, and one real pan screw
where the previous global structure was unresolved. B/C/D retain the same
D/P values, and B's length convention is unchanged. However, the experimental
bearing model makes C's L worse than the production baseline, and D/MS L
remains unresolved.

**Do not merge** this experiment into `feature/semantic-pixel-ownership`
on the present evidence. Next controlled experiment should independently
validate shaft pixel ownership and local-frame axis on the MS35207-279
photograph, then verify whether the bearing surface is actually visible before
attempting any L fit. Do not adjust the contour or bearing-plane position
toward catalog nominal dimensions.

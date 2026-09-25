# Adaptive major-diameter D — image-space evidence contract

This is a geometry primitive; it must not depend on a fastener name, M-size,
catalog diameter or the GT of any benchmark case.

## Measurement routes

1. **Two observed sides**: two separately tracked raw-image crests, each
   verified against its local optical edge spread. Their independent outward
   crest envelopes add to the major diameter. They need not occur at the
   same axial coordinate.
2. **One observed crest + independent centerline**: when only one threaded
   flank is resolved, look for a *different* axial section showing a straight,
   bilaterally observable, constant-width cylindrical surface. Two raw-image
   edge tracks establish its centerline, which can be extrapolated along the
   same physical screw axis. Remove that axis segment from the crest candidates;
   measure repeated peaks on the separate trusted thread flank after subtracting
   the centerline, and double their radial distance.

The current second route requires bilateral smooth-shank evidence. A screw
need not have an exposed smooth shank, so this route is **optional**, never
an assumption that one exists. Both trusted crest sides still work on a
fully threaded screw. More independent axis sources (e.g., validated symmetric
head features) can be added later, each with its own independent evidence tests.

## Non-negotiable invariants

- Coarse binary contour is a search prior, **not** a physical edge.
- Smooth-reference axis never derives from the selected thread flank, the
  other flank's guessed pitch, or a catalog radius. Its reference section and
  final crest section are disjoint.
- Do not call a blurred/flat thread-root edge a major-diameter crest merely
  because a smooth-shank median can be fitted there.
- Per-side image-quality metrics include contrast, optical blur, relative
  fit residual and optical fit uncertainty.
- Missing sides or missing independent axis yield explicit non-measurement.
  A photo with just one line and no known centerline cannot determine diameter:
  D = 2r requires independently locating the center.
- Uncertainty outputs are **image-space quality proxies**, not calibrated
  statistical confidence intervals. Extrapolation contributes additional
  uncertainty. Do not label them certified ± accuracy.

## Diagnostics

`edge_diameter_mode_code`: 2 = two trusted flanks; 1 = one trusted flank plus
independently observed smooth-shank axis; 0 = insufficient evidence. For mode 1
the result also exposes axis reference sample count, residual, slope and
uncertainty. Old contour-D remains a **diagnostic only**, never a fallback
that overwrites failure.

## Verification

- Unit tests vary diameter, tooth pitch, damaged-side orientation and overall
  orientation; separate negatives remove the centerline evidence entirely.
- The true-photo benchmark is a different layer: a workflow can pass because
  L works and D **honestly refuses** to produce an unsupported value. That
  does not constitute measured-D success on the real image.
- Changes to fundamental P and head-underface L are intentionally out of
  scope. They continue using their established geometry paths.

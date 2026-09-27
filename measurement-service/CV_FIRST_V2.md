# CV-first v2 evidence flow

CV-first v2 keeps deterministic measurements separate from semantic inference:

1. The measurement service acquires fixed D, P, both L candidates, K and DK.
   Optional B never blocks the main flow.
2. The head_geometry field summarizes the observed side silhouette
   independently of those dimensions. It reports normalized profile points,
   shape ratios, boundary provenance, quality and reason codes.
3. The vision LLM receives only concise physical evidence plus the original
   image. It may choose among visually similar head styles, but it may not
   rewrite CV measurements.
4. The head-style-consistency evaluator rejects an LLM head choice only when a
   reliable physical silhouette contradicts its length-convention class.
   Ambiguous or degraded geometry cannot manufacture a head style.
5. The final purchase gate requires usable D, P, K, DK, the
   head-style-selected L, reliable head geometry and no physical conflict. A
   second completeness gate requires a resolved head/thread system, a complete
   nominal D/P/L expression and an observable drive form.

## Head geometry quality

- reliable: sufficient profile support with low roughness and centerline drift.
- degraded: measurements are retained, but the silhouette cannot verify a full
  purchase specification.
- unusable: no defensible head profile was obtained.

boundary_source=bearing_plane means the protruding-head shoulder estimator
found a physical underface. coarse_transition is a silhouette-only fallback
for shapes such as countersunk heads; it never replaces either deterministic
length landmark.

Representative reason codes include head_profile_samples_insufficient,
head_profile_centerline_drift, head_profile_rough and
head_bearing_plane_unresolved.

## Public messages and diagnostics

The API returns actionable, non-technical text in user_guidance. Machine
evidence remains under specification_evidence, while full diagnostic objects
are written to server logs. The UI-facing purchase description never contains
an unverified drive size. PH2, T20, H4 and similar tokens are removed; metric
or imperial fastener dimensions such as M3 and #10-24 are preserved.

No percentage confidence score is synthesized. A single photograph still
cannot independently verify object/ruler coplanarity, so that condition remains
unknown.

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
   nominal D/P/L expression. Drive form and size remain optional evidence and
   are never guessed from a side view.

The semantic localizer and final identifier share one head-style taxonomy.
Pan, truss, button, round and socket-cap labels are distinguished with
qualitative silhouette features (where taper starts, whether a lower skirt is
present, and whether the wall is cylindrical), not fixed K/DK thresholds or a
catalogue lookup. `other` means the visible form positively falls outside the
listed families; translation uncertainty alone is not a reason to use it.

## Head geometry evidence partition

Head evidence is intentionally split into three independent questions:

- bearing-plane validity: whether a physical under-head bearing plane supports
  L_underhead. A valid bearing plane is not invalidated by a later silhouette
  integrity failure.
- envelope dimensions: whether K and DK were physically measured. Their
  arithmetic ratios remain available even if the detailed profile is degraded.
- silhouette integrity: whether the complete side profile is continuous enough
  to constrain a semantic head subtype.

Silhouette quality is:
- reliable: sufficient profile support with low roughness and centerline drift.
- degraded: D/P/L/K/DK and bearing/envelope evidence may remain valid, but the
  detailed normalized profile must not constrain the LLM head subtype.
- unusable: no defensible detailed head profile was obtained.

A degraded silhouette blocks the final complete-purchase gate, but it no longer
turns otherwise valid dimensions into appearance-only evidence. This separation
is generic: it does not map any K/DK ratio or Case-specific value to a head name.

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

When numbered-thread arithmetic and the measured length support a reversible
dimension notation but the semantic head gate is unresolved, the API may
return a separate `dimension_candidate`. It is explicitly dimension-only,
excludes head style, drive form/size and thread-series claims, and never changes
`purchase_ready=false` into a complete purchase specification.

No percentage confidence score is synthesized. A single photograph still
cannot independently verify object/ruler coplanarity, so that condition remains
unknown.

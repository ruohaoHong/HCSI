# Semantic calibration candidate corpus storage

This directory is reserved for independently acquired physical-specimen calibration corpus material.

Phase 2F does **not** contain any real specimen bytes yet. Do not add regression fixtures, sealed blind cases, synthetic/generated images, internet images, supplier screenshots, or model-selected examples here.

Expected flow:

1. Create and lock an acquisition ledger entry before any semantic sensor observation.
2. Preserve exact original image bytes.
3. Record independent semantic ground truth.
4. Bind each materialized image file to the corpus manifest.
5. Run the deterministic Phase 2F intake validator.
6. Keep accepted material as candidate/acquired corpus only; do not add it to the production calibration registry in Phase 2F.

Directories:
- `acquisition/` — versioned acquisition ledger material.
- `manifests/` — real-corpus intake manifests/bundles.

Production calibration fitting and admission are intentionally out of scope.

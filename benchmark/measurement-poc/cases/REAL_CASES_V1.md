# Fixed Real Measurement Cases v1

Cases A-E are locked as immutable benchmark fixtures.

## Rules

- Treat image bytes + Ground Truth + length convention as one inseparable fixture.
- Verify SHA-256 before every rerun.
- Never replace a missing fixture with a visually similar image.
- Never infer or revise Ground Truth from model output.
- Semantic regions in the manifest use normalized 0-1000 coordinates.

## Current case registry (2026-09-29)

This registry is the human-facing naming used for the next head-style generalization tests.
It does **not** mutate or discard the immutable A-E v1 fixture history below.

| Current label | Role / head | Status | Notes |
|---|---|---|---|
| A | pan | existing | Original immutable Case A. |
| B | flat/countersunk | existing | Original immutable Case B. |
| **C** | **hex** | **new candidate** | New ruler-parallel / separated Hex photo selected to replace the old C composition for future testing. Exact bytes/SHA must be locked before inference. |
| **C-ruler-contact** | **hex** | **legacy stress fixture** | Former immutable Case C. Ruler and screw are touching / too close; retained for regression and to make the capture-condition defect obvious by name. |
| D | pan | existing | Original immutable Case D. |
| E | socket_cap | existing | Original immutable Case E. |
| **F** | **button** | **new candidate** | Polaris 7519774, M6 × 1.0 × 15 mm Button Head Hex Screw. Exact candidate image bytes/SHA still need to be locked. |
| **G** | **truss** | **new candidate** | Univair AN526C1032R8, #10-32 × 1/2 in truss-head screw. Exact candidate image bytes/SHA still need to be locked. |

Naming rule: the old v1 `id: "C"` remains untouched inside the immutable historical fixture list,
but in all new work it should be referred to as **C-ruler-contact**. The next separated Hex fixture,
once its exact image bytes and SHA-256 are frozen, becomes the active **Case C**.

## Ground Truth

| Case | Spec | D (mm) | P (mm) | L (mm) | L convention |
|---|---|---:|---:|---:|---|
| A | #10-32 x 7/8 in pan | 4.826 | 0.79375 | 22.225 | head underface -> tip |
| B | M6-1.0 x 40 DIN 965 flat/countersunk | 6.0 | 1.0 | 40.0 | head top -> tip |
| C | M14-2.0 x 45 hex | 14.0 | 2.0 | 45.0 | head underface -> tip |
| D | #8-32 x 13/32 in pan | 4.1656 | 0.79375 | 10.31875 | head underface -> tip |
| E | M3 x 30 socket cap | 3.0 | 0.5 | 30.0 | head underface -> tip |

The exact private fixture bytes are stored in the user's ChatGPT Library at:
`/HCSI/benchmarks/hcsi-real-measurement-cases-v1/`

Case E also retains its repository-safe WebP Q80 derivative at:
`benchmark/measurement-poc/cases/case-e-m3x30-q80.part*.b64`

Baseline code for the fully passing Case E workflow is commit:
`64f8f405ff01053b2d0c8a29e8376119e9032dba`.

See `real-cases-v1.json` for exact hashes, source provenance, semantic regions, and workflow artifact IDs.

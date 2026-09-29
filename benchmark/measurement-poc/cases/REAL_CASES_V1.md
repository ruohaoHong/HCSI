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
| **C** | **hex** | **locked fixture** | New ruler-parallel / separated Hex photo. Exact uploaded bytes locked: `case-c-hex-ruler-separated.png`, SHA-256 `98896d298c40b87388083bac6e51df0c2d6b18460e9e29a2b7be9899f6201b9f`. GT: M14 × 2.0 × 45 mm, head_style=`hex`. |
| **C-ruler-contact** | **hex** | **legacy stress fixture** | Former immutable Case C. Ruler and screw are touching / too close; retained for regression and to make the capture-condition defect obvious by name. |
| D | pan | existing | Original immutable Case D. |
| E | socket_cap | existing | Original immutable Case E. |
| **F** | **button** | **locked fixture** | Polaris 7519774, M6 × 1.0 × 15 mm Button Head Hex Screw. `case-f-button.png`, SHA-256 `ae0bb78703b07e520e3dc7516e775aad6e627571d8e474c3d61cc924b4f0ea91`. |
| **G** | **truss** | **locked fixture** | Univair AN526C1032R8, #10-32 × 1/2 in truss-head screw. `case-g-truss.png`, SHA-256 `fcd71e295dd2b6bf1c6aa3fe5a43be55b68df3b0bb6263f87a7e86b524e11f69`. |

Naming rule: the old v1 `id: "C"` remains untouched inside the immutable historical fixture list,
but in all new work it should be referred to as **C-ruler-contact**. The next separated Hex fixture,
its exact image bytes and SHA-256 are now frozen, so it is the active **Case C**.

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

## Active Case C fixture

- Fixture: `case-c-hex-ruler-separated.png`
- Storage: `/HCSI/benchmarks/hcsi-real-measurement-cases-v2/case-c-hex-ruler-separated.png`
- SHA-256: `98896d298c40b87388083bac6e51df0c2d6b18460e9e29a2b7be9899f6201b9f`
- Image: 800 × 800 PNG, 600469 bytes
- GT: M14 × 2.0 × 45 mm, Hex head
- D = 14.0 mm; P = 2.0 mm; L = 45.0 mm
- Length convention: head underface -> tip
- Capture condition: ruler parallel to screw and separated from it
- Historical former Case C remains unchanged and is referred to as `C-ruler-contact`.

## Active Case F fixture

- Fixture: `case-f-button.png`
- Storage: `/HCSI/benchmarks/hcsi-real-measurement-cases-v2/case-f-button.png`
- SHA-256: `ae0bb78703b07e520e3dc7516e775aad6e627571d8e474c3d61cc924b4f0ea91`
- GT: M6 × 1.0 × 15 mm, Button head
- D = 6.0 mm; P = 1.0 mm; L = 15.0 mm
- Length convention: head underface -> tip
- Capture condition: ruler parallel to screw and separated from it

## Active Case G fixture

- Fixture: `case-g-truss.png`
- Storage: `/HCSI/benchmarks/hcsi-real-measurement-cases-v2/case-g-truss.png`
- SHA-256: `fcd71e295dd2b6bf1c6aa3fe5a43be55b68df3b0bb6263f87a7e86b524e11f69`
- GT: #10-32 × 1/2 in, Truss head
- D = 4.826 mm; P = 0.79375 mm; L = 12.7 mm
- Length convention: head underface -> tip
- Capture condition: ruler parallel to screw and separated from it

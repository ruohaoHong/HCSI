# Fixed Real Measurement Cases v1

Cases A-E are locked as immutable benchmark fixtures.

## Rules

- Treat image bytes + Ground Truth + length convention as one inseparable fixture.
- Verify SHA-256 before every rerun.
- Never replace a missing fixture with a visually similar image.
- Never infer or revise Ground Truth from model output.
- Semantic regions in the manifest use normalized 0-1000 coordinates.

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

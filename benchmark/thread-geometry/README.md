# Thread Geometry Benchmark

This benchmark is intentionally isolated from the production HCSI inference path.
Its purpose is to test whether scale-invariant pixel geometry from ordinary screw photos can discriminate nominal fastener candidates before we integrate any CV logic into the app.

## Research question

Can a side-view screw image provide a stable estimate of thread pitch divided by major diameter (`P/D`) that is useful for candidate elimination?

The first target confusion pair is:

- M8×1.25: theoretical `P/D = 1.25 / 8 = 0.15625`
- 5/16-18 UNC: theoretical `P/D = (25.4 / 18) / 7.9375 = 0.177777...`

Additional controls:

- M6×1.0: `0.166666...`
- 1/4-20 UNC: `0.2`
- 3/8-16 UNC: `0.166666...`

Important: `P/D` is not unique. M6×1.0 and 3/8-16 have essentially the same ratio, so the intended architecture is candidate scoring rather than direct lookup.

## Benchmark rules

1. Ground truth must come from a source that explicitly identifies the photographed/drawn SKU or standard.
2. Engineering drawings/CAD renders and real photographs are tracked as different image domains.
3. Do not tune thresholds per screw size or per individual image.
4. The measurement algorithm must not use the ground-truth label while measuring pixels.
5. Record multiple pitch intervals and multiple crest-diameter measurements; use robust statistics rather than one hand-picked measurement.
6. Store uncertainty/dispersion with every result.
7. Do not treat a generic or 'representative' product image as SKU-level ground truth.

## Dataset layers

### Layer A — ideal geometry

Engineering drawings or CAD renders with explicit dimensions. This tests whether the geometry extraction algorithm is correct under clean conditions.

### Layer B — product imagery

Vendor product images with explicit SKU-level specifications. This adds rendering, reflections and material appearance.

### Layer C — user/mobile imagery

Ordinary photos with known ground truth. This adds perspective, blur, fingers, background clutter and compression.

## Initial pipeline

1. Crop a threaded-shaft ROI.
2. Estimate shaft axis and rectify orientation.
3. Detect left/right outer thread envelopes.
4. Estimate repeated thread period from multiple independent signals.
5. Estimate major/crest diameter from multiple rows/crests.
6. Compute `P_px / D_px`.
7. Compare against the structured candidate table.
8. Later fuse the geometry score with VLM system classification (Metric vs Unified), head family and drive geometry.

## First benchmark sources

The metadata and exact theoretical values are in `ground-truth.csv`.

Aspen Fasteners engineering drawings are referenced by URL only; the third-party PDFs are not copied into this repository.

## Success criteria for the first POC

The first POC is useful if repeated measurements on independent images show:

- the expected ordering between M8×1.25 and 5/16-18,
- measurement variance small enough that the two distributions are meaningfully separated,
- and ideal-drawing measurements substantially outperform uncontrolled mobile photos.

If ideal geometry fails, fix the CV measurement algorithm. If ideal geometry works but mobile images fail, focus on perspective, silhouette and reflection correction before integrating anything into HCSI production.

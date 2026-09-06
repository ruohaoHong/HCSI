# HCSI Screw Identification Reference
Version: 1.0-production-draft

## 0. 使用原則

這份 reference 是辨識知識，不是待辨識物件。

對目前使用者上傳的照片，先判斷實際可觀察到的證據，再使用本 reference 中對應的規格知識。不要因為某個規格出現在 reference 中，就提高它的先驗可信度。

### Evidence classes

**A. Absolute dimensional evidence（絕對尺寸證據）**
例如可讀取的卡尺、尺規、量規、包裝標示，或其他能把照片中的物件可靠連結到實際 mm / inch / TPI 的資訊。

只有存在這類證據時，才能把照片中的尺寸直接與規格表數值比對。

**B. Relative geometric evidence（相對幾何證據）**
例如牙距相對於螺紋外徑的比例、相對牙密度、可見牙峰數量、螺旋線相對形態。

這些資訊在沒有絕對比例尺時仍可能具有辨識力，但會受到透視、旋轉、解析度、模糊與遮擋影響。

**C. Morphological evidence（形態證據）**
例如左右旋方向、牙型輪廓、頭型、驅動槽、標記，以及管件／錐牙等整體形態。

### 禁止的推論
- 不可把照片中的 pixel width 直接當成實際 mm / inch。
- 不可因為「看起來像某張 reference image」就宣稱精確規格。
- 不可用單一外觀特徵覆蓋互相矛盾的其他證據。
- 不可因某規格常見就把它當成已被照片證明。
- 不可把 reference image 的畫面尺寸當成測量模板。

---

## 1. 規格系統

### ISO Metric

表示例：
`M8 × 1.25`

- `M`：ISO Metric thread family
- `8`：nominal major diameter = 8 mm
- `1.25`：pitch = 1.25 mm

同一 nominal diameter 可以存在不同 pitch，因此「M8」本身不代表所有 M8 都是相同牙距。

常見辨識候選：

| Designation | Nominal major diameter | Common coarse pitch | Common fine candidates |
|---|---:|---:|---:|
| M3 | 3.0 mm | 0.50 mm | — |
| M4 | 4.0 mm | 0.70 mm | — |
| M5 | 5.0 mm | 0.80 mm | — |
| M6 | 6.0 mm | 1.00 mm | — |
| M8 | 8.0 mm | 1.25 mm | 1.00 mm |
| M10 | 10.0 mm | 1.50 mm | 1.25 / 1.00 mm |
| M12 | 12.0 mm | 1.75 mm | 1.50 / 1.25 mm |
| M14 | 14.0 mm | 2.00 mm | 1.50 mm |
| M16 | 16.0 mm | 2.00 mm | common finer pitches also exist |
| M18 | 18.0 mm | 2.50 mm | common finer pitches also exist |
| M20 | 20.0 mm | 2.50 mm | common finer pitches also exist |

這不是完整 ISO pitch catalog；用途是提供常見辨識候選。

### Unified inch threads

表示例：
`5/16-18 UNC`

- `5/16`：nominal diameter in inches
- `18`：threads per inch (TPI)
- `UNC`：Unified National Coarse

`5/16-24 UNF`
- same nominal diameter
- 24 TPI
- `UNF`：Unified National Fine

常見辨識候選：

| Nominal size | Major diameter approx. | UNC | UNF |
|---|---:|---:|---:|
| #6 | 3.505 mm | 32 TPI | 40 TPI |
| #8 | 4.166 mm | 32 TPI | 36 TPI |
| #10 | 4.826 mm | 24 TPI | 32 TPI |
| #12 | 5.486 mm | 24 TPI | 28 TPI |
| 1/4 | 6.350 mm | 20 TPI | 28 TPI |
| 5/16 | 7.9375 mm | 18 TPI | 24 TPI |
| 3/8 | 9.525 mm | 16 TPI | 24 TPI |
| 7/16 | 11.1125 mm | 14 TPI | 20 TPI |
| 1/2 | 12.700 mm | 13 TPI | 20 TPI |
| 5/8 | 15.875 mm | 11 TPI | 18 TPI |
| 3/4 | 19.050 mm | 10 TPI | 16 TPI |

軸向 pitch 可用：
`pitch_mm = 25.4 / TPI`

這只是在 mm 與 TPI 之間轉換軸向間距；數值接近不代表不同 thread family 可以互換。

### Thread-family visual reference

![Thread-family reference](./reference-images/thread-families.jpg)

用途：建立不同螺紋系統／牙型概念的視覺關係。

限制：不可從圖中的繪製尺寸推導待辨識物的實際尺寸。

---

## 2. 高風險近似規格

### M8 vs 5/16 inch

| Candidate | Nominal major diameter | Thread spacing |
|---|---:|---:|
| M8 × 1.25 | 8.000 mm | 1.250 mm |
| 5/16-18 UNC | 7.9375 mm | ≈1.411 mm |
| 5/16-24 UNF | 7.9375 mm | ≈1.058 mm |

M8 與 5/16 inch 的 nominal diameter 差：
`0.0625 mm`

因此外徑非常接近；單靠外徑是高風險判斷。

### Scale-independent relative geometry

Approximate pitch / nominal-diameter ratio：

- M8 × 1.25 → `1.25 / 8 ≈ 0.156`
- 5/16-18 UNC → `1.411 / 7.9375 ≈ 0.178`
- 5/16-24 UNF → `1.058 / 7.9375 ≈ 0.133`

因此即使沒有絕對尺度，牙距相對於螺紋直徑的視覺比例仍可能提供區分資訊。

但只有在照片角度、解析度與可見螺紋足以支持比較時，才能提高其權重。

![M8 and 5/16 near-match case](./reference-images/m8-vs-5-16-visual.jpg)

這是「易混淆案例」而不是已驗證左右標籤的標準樣本。不可自行假設畫面左／右分別是哪一規格。

### 其他常見直徑近似候選

- M6 6.00 mm ↔ 1/4 inch 6.35 mm
- M8 8.00 mm ↔ 5/16 inch 7.9375 mm
- M10 10.00 mm ↔ 3/8 inch 9.525 mm
- M12 12.00 mm ↔ 1/2 inch 12.70 mm

遇到這些候選時，不要只用 nominal diameter；應結合 pitch/TPI、相對牙密度、標記、牙型與其他可見證據。

---

## 3. Coarse / Fine thread

同一 nominal diameter 不代表唯一 pitch。

第一支來源影片的公制例子：
- M12 常見 coarse pitch = 1.75 mm
- 更小的 pitch 代表較細密的螺紋候選

Unified 系統則常見 UNC / UNF 的 coarse/fine 區分。

沒有絕對尺度時：
- 不可宣稱照片中的 pitch 是精確的 1.25 mm、1.5 mm 等；
- 但可以在影像品質足夠時使用「相對牙密度」作為候選區分證據。

![Metric coarse/fine](./reference-images/metric-coarse-fine.jpg)

![Unified coarse/fine](./reference-images/unified-coarse-fine.jpg)

---

## 4. Thread direction

Right-hand / Left-hand thread 的核心差異是 helix direction。

這主要屬於 morphological evidence，不需要知道物件實際直徑。

只有在螺旋方向清楚可見時才使用。若照片可能被鏡像、螺紋邊緣不清楚或視角造成方向歧義，降低或取消此證據權重。

![Left-hand thread reference](./reference-images/left-hand-thread.jpg)

---

## 5. Pipe-thread branch

若物件呈現 pipe fitting、nipple、plumbing connector、tapered threaded fitting、sealing connection 等形態，不要強迫歸類為一般 M / UNC / UNF fastener。

來源影片另外討論 PT / PF / NPT 等管用螺紋。

![Pipe-thread examples](./reference-images/pipe-thread-examples.jpg)

本 reference 尚未提供完整 pipe-thread dimensional catalog。因此只有外型／情境證據時，可以辨識到較廣的 pipe-thread family；不可捏造精確 NPT / PT / PF 尺寸。

---

## 6. Evidence weighting

辨識時優先使用「真正存在於目前照片」且具有區分力的證據。

一般原則：

**強證據**
- 清楚可讀、與零件直接相關的尺寸量測
- 清楚可讀的規格標記
- 已知規格 thread gauge / thread checker 的可靠配合結果

**中等證據**
- 足夠清晰的相對 thread density
- pitch-to-diameter visual relationship
- 清楚的 helix direction
- 可辨識的 thread-form / fitting morphology

**弱證據**
- 單純「看起來像」
- apparent pixel size
- 常見度
- 模糊或透視嚴重的牙距印象

證據強弱不是固定分數。影像品質與候選之間的實際區分力會改變權重。

---

## 7. One-shot identification rule

HCSI 是 one-shot identification。

不要僅因：
- 沒有尺／卡尺；
- 無法得到精確 pitch；
- 存在多個合理候選；
- confidence 不高；

就要求使用者補拍。

應利用目前影像中的 absolute dimensional、relative geometric、morphological evidence，給出技術上最合理的判斷並如實表達不確定性。

只有嚴重失焦、模糊、過暗、遮擋，或零件本身缺乏足夠可見細節，以致無法進行有意義辨識時，才判定影像不可用。

---

## 8. Decision examples

### Case A — near 8 mm + visible coarse/fine relationship

若存在可靠尺寸證據顯示 major diameter 約 8 mm：
- M8 與 5/16 inch 都應進入候選；
- 不可因為「8 mm」就直接停止在 M8；
- 再利用 pitch/TPI 或相對 thread density 區分。

### Case B — no absolute scale

照片沒有尺或卡尺，但螺紋側視清晰：
- 不可宣稱 major diameter = 8 mm；
- 可以觀察 thread spacing relative to visible diameter；
- 若該相對幾何明顯支持某候選，可提高該候選信心；
- 如果候選間差異小於照片能可靠表達的程度，保留不確定性。

### Case C — visible left/right helix

若 helix direction 清晰：
- 可直接把方向作為 morphological evidence；
- 不需要先知道實際尺寸。

### Case D — pipe-fitting morphology

若物件整體明顯屬於管件／密封接頭：
- 優先進入 pipe-thread branch；
- 不因其具有外螺紋就直接套入普通 M / UNC / UNF bolt table。

---

## 9. Final reasoning constraint

對每個候選規格，內部判斷應區分：

- 哪些 FACT 來自 reference；
- 哪些 OBSERVATION 真正來自目前使用者照片；
- FACT 與 OBSERVATION 是否能合法比較；
- 哪些 competing candidates 被目前證據排除；
- 哪些仍無法排除。

最終答案不需要輸出完整 chain-of-thought，但不得把 reference fact 偽裝成照片 observation。

---

## 10. Scope

目前 production reference v1 聚焦：
- common ISO Metric threads
- common Unified UNC / UNF threads
- coarse / fine discrimination
- Metric vs inch near-matches
- thread direction
- pipe-thread routing
- evidence gating

它不是所有 screw/thread standards 的完整 catalog。

當照片可能屬於 reference 範圍外的規格時，允許辨識到較廣的 family，並降低 exact-spec confidence；不要硬套最近的表格候選。

## Source basis

Primary instructional sources:
1. `螺絲懶人包｜螺絲規格判斷 & 公英美制牙分辨大全【中英字幕】`
2. `M8跟5_16到底差在哪？很多人量了還是分不出來！`

Numeric cross-check basis:
- ISO 262 — ISO general purpose metric screw threads, selected sizes
- ASME B1.1 — Unified Inch Screw Threads
- common Metric pitch and Unified TPI reference tables

Reference images are teaching/evidence examples. Numeric specification text takes precedence over text that may be visually embedded in a low-resolution video frame.

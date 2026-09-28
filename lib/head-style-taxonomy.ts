export const HEAD_STYLE_VALUES = [
  'hex',
  'flat_countersunk',
  'pan',
  'truss',
  'button',
  'socket_cap',
  'round',
  'other',
  'unknown',
] as const

export type HeadStyle = (typeof HEAD_STYLE_VALUES)[number]

export const PROTRUDING_HEAD_STYLES: HeadStyle[] = [
  'hex', 'pan', 'truss', 'button', 'socket_cap', 'round',
]

/**
 * Visual semantics only.  These descriptions deliberately contain no
 * dimensional thresholds or catalogue mappings: CV supplies the measured
 * silhouette and the model assigns the closest compatible language label.
 */
export const HEAD_STYLE_SEMANTIC_GUIDANCE = `
head_style 是外觀語義分類，請把照片與 CV normalized_profile 一起判讀：
- flat_countersunk：頭部外輪廓由桿徑向外張開，安裝後設計為沉入或貼平表面。
- pan：突出頭；承面上方有一小段近似等寬的下緣／側裙，主要圓弧收窄集中在上半部。
- truss：突出且寬扁的淺圓頂；從接近承面處就持續收窄，幾乎沒有等寬側裙。
- button：較緊湊、連續圓滑的低圓頂，不具高直筒側壁，也不是特別寬扁的 truss 輪廓。
- socket_cap：高而近圓柱形，側壁大致筆直，頂面相對平。
- round：從承面到頂部大致連續成較高的圓弧，沒有明顯 pan 側裙。
- hex：外側可見多邊形／六角扳手面。

若照片用中文自由文字描述出可辨識的標準外形，結構化 head_style 也要選相符的 enum；
不要只因名稱翻譯不確定而填 other。輪廓足夠但相近類型仍有歧義時，選照片與 CV
綜合證據支持度最高的一個，並把次要候選與不確定點放在 confusable_candidate /
uncertain_fields。只有外形明確不屬於上述類別時才用 other；真的看不清楚才用 unknown。
`.trim()

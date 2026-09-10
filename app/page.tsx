'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  FileImage,
  Loader2,
  RotateCcw,
  Ruler,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import {
  CATEGORY_LABELS,
  type AnalysisResponse,
  type EvidenceLevel,
  type Provider,
} from '@/lib/identification'
import { isMeasurementResult, type MeasurementResult } from '@/lib/measurement'

const PROVIDERS: Array<{
  id: Provider
  label: string
  endpoint: string
  note: string
}> = [
  { id: 'gemini', label: 'Gemini', endpoint: '/api/analyze', note: 'Gemini 3.7 Flash' },
  { id: 'openai', label: 'OpenAI', endpoint: '/api/analyze-openai', note: 'GPT-5.6 Sol' },
  { id: 'grok', label: 'Grok', endpoint: '/api/analyze-grok', note: 'Grok 4.6' },
]

type PreflightState = 'idle' | 'checking' | 'ready' | 'unavailable'
type ProviderResponse = AnalysisResponse & { measurement?: MeasurementResult | null }

export default function Page() {
  const [imageUrl, setImageUrl] = useState('')
  const [imageData, setImageData] = useState('')
  const [processingProvider, setProcessingProvider] = useState<Provider | null>(null)
  const [results, setResults] = useState<Partial<Record<Provider, AnalysisResponse>>>({})
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({})
  const [measurement, setMeasurement] = useState<MeasurementResult | null>(null)
  const [preflightState, setPreflightState] = useState<PreflightState>('idle')
  const [preflightError, setPreflightError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setResults({})
    setErrors({})
    setProcessingProvider(null)
    setMeasurement(null)
    setPreflightState('checking')
    setPreflightError('')

    const previewUrl = URL.createObjectURL(file)
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return previewUrl
    })

    try {
      const compressed = await compressImage(file)
      setImageData(compressed)
      await runPreflight(compressed)
    } catch (error) {
      setImageData('')
      setPreflightState('idle')
      setErrors({ gemini: error instanceof Error ? error.message : '影像讀取失敗' })
    }
  }

  async function runPreflight(image: string) {
    setPreflightState('checking')
    setPreflightError('')
    try {
      const response = await fetch('/api/measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMeasurement(null)
        setPreflightError(data.error || '量測服務目前無法使用。')
        setPreflightState('unavailable')
        return
      }
      if (!isMeasurementResult(data.measurement)) throw new Error('量測預檢結果格式不完整')
      setMeasurement(data.measurement)
      setPreflightState('ready')
    } catch (error) {
      setMeasurement(null)
      setPreflightError(error instanceof Error ? error.message : '量測服務目前無法使用。')
      setPreflightState('unavailable')
    }
  }

  function clearImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl('')
    setImageData('')
    setResults({})
    setErrors({})
    setMeasurement(null)
    setPreflightState('idle')
    setPreflightError('')
    setProcessingProvider(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function analyze(provider: Provider) {
    if (!imageData || processingProvider || preflightState === 'checking') return
    const config = PROVIDERS.find((item) => item.id === provider)
    if (!config) return

    setProcessingProvider(provider)
    setErrors((previous) => ({ ...previous, [provider]: undefined }))

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })
      const data = await response.json() as ProviderResponse & { error?: string }
      if (!response.ok) throw new Error(data.error || `${config.label} 辨識服務暫時無法使用`)
      setResults((previous) => ({ ...previous, [provider]: data as AnalysisResponse }))
      if (!measurement && data.measurement && isMeasurementResult(data.measurement)) {
        setMeasurement(data.measurement)
        setPreflightState('ready')
      }
    } catch (caught) {
      setErrors((previous) => ({
        ...previous,
        [provider]: caught instanceof Error ? caught.message : '發生未知錯誤，請稍後再試',
      }))
    } finally {
      setProcessingProvider(null)
    }
  }

  const completedCount = Object.keys(results).length

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-10 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-border py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ScanLine size={19} />
            </div>
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">HCSI / FIELD IDENTIFIER</p>
              <p className="text-sm font-semibold tracking-tight">五金水電零件辨識</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:flex">
            <span className="size-1.5 rounded-full bg-accent" />
            3 API COMPARE
          </div>
        </header>

        <section className="grid flex-1 gap-10 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-20 lg:py-16">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="size-1.5 rounded-full bg-accent" /> 居家 DIY / 工地工具
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                不知道這是什麼？<br />
                <span className="text-accent">拍下來辨識</span>
              </h1>
              <p className="max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
                辨識居家 DIY 與工地常見的緊固件、水管件、電氣配線、裝潢五金與維修零件；若照片含可靠尺度參考，會先量測再交給模型判讀。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {['緊固／固定', '水管／管件', '電氣／配線', '裝潢五金', '維修零件'].map((label) => (
                <span key={label} className="rounded-full border border-border bg-card px-3 py-1.5">{label}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>01 / 拍攝</span><ChevronRight size={13} /><span>02 / 尺度預檢</span><ChevronRight size={13} /><span>03 / 選 API</span><ChevronRight size={13} /><span>04 / 比較</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-2 rounded-2xl border border-accent/20" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-primary/5">
              {!imageUrl ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="group flex min-h-[330px] w-full flex-col items-center justify-center gap-5 p-8 text-center transition-colors hover:bg-muted/50 sm:min-h-[390px]"
                >
                  <span className="grid size-16 place-items-center rounded-2xl border border-border bg-muted text-muted-foreground transition-all group-hover:border-accent group-hover:bg-accent/10 group-hover:text-accent">
                    <Camera size={28} strokeWidth={1.5} />
                  </span>
                  <span>
                    <strong className="block text-base font-semibold">拍照或上傳零件</strong>
                    <span className="mt-1 block text-sm text-muted-foreground">有公制尺可一起入鏡；沒有尺仍可辨識五金種類</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
                    <Upload size={15} /> 選擇影像
                  </span>
                </button>
              ) : (
                <div className="relative">
                  <img src={imageUrl} alt="待辨識零件預覽" className="max-h-[460px] min-h-[300px] w-full bg-muted/30 object-contain p-3" />
                  <div className="absolute left-5 top-5 flex items-center gap-2 rounded-md bg-primary/90 px-2.5 py-1.5 font-mono text-[10px] text-primary-foreground">
                    <FileImage size={13} /> 已載入影像
                  </div>
                  <button type="button" onClick={clearImage} aria-label="清除影像" className="absolute right-5 top-5 grid size-9 place-items-center rounded-md bg-primary/90 text-primary-foreground transition-colors hover:bg-accent">
                    <X size={17} />
                  </button>
                </div>
              )}
              <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={handleFile} />

              {imageUrl && (
                <div className="border-t border-border p-4">
                  <MeasurementPreflight measurement={measurement} state={preflightState} error={preflightError} />
                  <button type="button" onClick={() => inputRef.current?.click()} className="mb-3 mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted">
                    <RotateCcw size={15} /> 重新拍攝
                  </button>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {PROVIDERS.map((item) => {
                      const isProcessing = processingProvider === item.id
                      const hasResult = Boolean(results[item.id])
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => analyze(item.id)}
                          disabled={!imageData || Boolean(processingProvider) || preflightState === 'checking'}
                          className="flex min-h-16 items-center justify-center gap-2 rounded-md border border-border px-3 py-3 text-sm font-semibold transition-colors hover:border-accent hover:bg-accent/5 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isProcessing ? <Loader2 size={16} className="animate-spin" /> : hasResult ? <Check size={16} className="text-accent" /> : <Sparkles size={16} />}
                          <span className="text-left">
                            <span className="block">{item.label}</span>
                            <span className="block font-mono text-[9px] font-normal text-muted-foreground">{item.note}</span>
                          </span>
                          {!isProcessing && <ArrowUpRight size={14} />}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
                    三個 provider 使用相同 reference 與量測原則；已完成 {completedCount}/3。
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section aria-live="polite" className="pb-10">
          {processingProvider && (
            <div className="mb-5 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="grid size-8 place-items-center rounded-full bg-accent/15 text-accent"><Loader2 size={16} className="animate-spin" /></div>
                <div>
                  <p className="text-sm font-semibold">{providerLabel(processingProvider)} 正在分類並進行專科辨識</p>
                  <p className="text-xs text-muted-foreground">有可靠量測時使用 deterministic 尺寸證據；沒有尺度時只做外觀辨識，不自行猜 mm。</p>
                </div>
              </div>
            </div>
          )}

          {Object.keys(errors).length > 0 && (
            <div className="mb-5 space-y-2">
              {PROVIDERS.map((item) => errors[item.id] ? (
                <div key={item.id} className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm">
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
                  <div><p className="font-semibold">{item.label} 辨識未完成</p><p className="mt-1 text-muted-foreground">{errors[item.id]}</p></div>
                </div>
              ) : null)}
            </div>
          )}

          {completedCount > 0 && (
            <div className="grid gap-5 lg:grid-cols-3">
              {PROVIDERS.map((item) => results[item.id] ? <ResultCard key={item.id} response={results[item.id]!} /> : null)}
            </div>
          )}
        </section>

        <footer className="flex flex-col gap-3 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><CircleHelp size={14} /> 沒有可信尺度時，HCSI 不會從影像像素自行推算實際 mm；採購與施工前仍應核對關鍵規格</span>
          <span className="font-mono text-[10px] uppercase tracking-wider">HCSI / HARDWARE FIELD IDENTIFIER</span>
        </footer>
      </div>
    </main>
  )
}

function MeasurementPreflight({ measurement, state, error }: { measurement: MeasurementResult | null; state: PreflightState; error: string }) {
  if (state === 'checking') {
    return <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><Loader2 size={16} className="animate-spin" /><div><p className="font-medium">正在確認影像尺度</p><p className="text-xs text-muted-foreground">先找公制尺與可用幾何證據，再決定辨識模式。</p></div></div>
  }
  if (state === 'unavailable') {
    return <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><AlertCircle size={16} className="mt-0.5 shrink-0" /><div><p className="font-medium">量測服務目前不可用</p><p className="text-xs leading-5 text-muted-foreground">{error || '仍可使用外觀辨識，但本次不會有 deterministic 尺寸證據。'}</p></div></div>
  }
  if (!measurement) return null
  if (measurement.measurement_status === 'valid') {
    return <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm"><Ruler size={16} className="mt-0.5 shrink-0 text-accent" /><div><p className="font-medium">尺度已建立 · 實測約 {measurement.length_mm} × {measurement.width_mm} mm</p><p className="text-xs leading-5 text-muted-foreground">將以同一張照片的 deterministic 尺寸證據輔助三家 Vision LLM 判讀。</p></div></div>
  }
  if (measurement.measurement_status === 'no_reference') {
    return <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><CircleHelp size={16} className="mt-0.5 shrink-0" /><div><p className="font-medium">未建立可確認的尺度參考</p><p className="text-xs leading-5 text-muted-foreground">仍可辨識五金種類與可見結構，但精確尺寸／規格可能無法確認。之後可補拍含尺度參考的照片再辨識。</p></div></div>
  }
  return <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><AlertCircle size={16} className="mt-0.5 shrink-0" /><div><p className="font-medium">目前無法可靠量測，建議重新拍攝</p><p className="text-xs leading-5 text-muted-foreground">偵測到尺度或幾何線索，但不足以安全輸出實際尺寸。仍可只做外觀辨識；本次不會把失敗量測交給 LLM 當尺寸證據。</p></div></div>
}

function ResultCard({ response }: { response: AnalysisResponse }) {
  const result = response.result
  return (
    <article className="rounded-xl border border-accent/25 bg-card p-5">
      <div className="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-accent">{providerLabel(response.provider)} / {response.model}</p>
          <h2 className="mt-1 text-lg font-semibold">{result.item_name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">路由：{CATEGORY_LABELS[response.routing.category]} → 最終：{CATEGORY_LABELS[result.category]}</p>
        </div>
        <ShieldCheck size={18} className="shrink-0 text-muted-foreground" />
      </div>

      <div className="space-y-5 text-sm leading-6">
        <Section title="最可能是">
          <p className="font-medium">{result.most_likely_identification}</p>
          {result.common_names.length > 0 && <p className="mt-1 text-xs text-muted-foreground">常見叫法：{result.common_names.join('／')}</p>}
        </Section>

        <Section title="可見特徵">
          <ul className="space-y-1 text-muted-foreground">{result.visible_features.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}</ul>
        </Section>

        {result.specifications.length > 0 && (
          <Section title="規格判讀">
            <div className="space-y-2">
              {result.specifications.map((spec, index) => (
                <div key={`${spec.label}-${index}`} className="rounded-md bg-muted/55 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{spec.label}</span>
                    <EvidenceBadge level={spec.evidence_level} />
                  </div>
                  <p className="mt-1 text-muted-foreground">{spec.value}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="最容易混淆">
          <p>{result.confusable_candidate}</p>
          <p className="mt-1 text-muted-foreground">{result.key_differentiator}</p>
        </Section>

        <Section title="通常用途"><p className="text-muted-foreground">{result.typical_use}</p></Section>

        <Section title="去材料行可以這樣說">
          <p className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2.5 font-medium">{result.purchase_description}</p>
        </Section>

        {result.uncertain_fields.length > 0 && (
          <Section title="仍需確認">
            <ul className="space-y-1 text-muted-foreground">{result.uncertain_fields.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}</ul>
          </Section>
        )}

        <p className="border-t border-border pt-4 text-xs leading-5 text-muted-foreground">{result.safety_note}</p>
      </div>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>
}

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  const labels: Record<EvidenceLevel, string> = {
    observed: '可見',
    estimated: '目測',
    unconfirmed: '未確認',
  }
  return <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-muted-foreground">{labels[level]}</span>
}

function providerLabel(provider: Provider) {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const sourceUrl = URL.createObjectURL(file)

    image.onload = () => {
      try {
        const maxEdge = 1800
        const scale = Math.min(1, maxEdge / image.width, maxEdge / image.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('無法處理影像')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.86).split(',')[1])
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(sourceUrl)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl)
      reject(new Error('影像讀取失敗'))
    }

    image.src = sourceUrl
  })
}

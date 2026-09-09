'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  ChevronDown,
  FileImage,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'

type Phase = 'idle' | 'processing' | 'success' | 'error'
type Provider = 'gemini' | 'openai' | 'xai'
type NakedResult = {
  thread_system: string
  best_spec: string
  closest_competitor: string
  key_difference: string
  size_estimate: string
  conclusion: string
  diagnostic: {
    visual_observations: string[]
    evidence_for_system: string[]
    evidence_for_size: string[]
    evidence_against_best_spec: string[]
    decisive_evidence: string[]
    possible_failure_modes: string[]
  }
}

type ApiResponse = { provider: Provider; result: NakedResult; raw_output: string }

const providerMeta: Record<Provider, { name: string; note: string }> = {
  openai: { name: 'OpenAI', note: 'GPT vision' },
  gemini: { name: 'Gemini', note: 'Google vision' },
  xai: { name: 'Grok', note: 'xAI vision' },
}

export default function Page() {
  const [imageUrl, setImageUrl] = useState('')
  const [imageData, setImageData] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setData(null)
    setPhase('idle')
    setProvider(null)

    const url = URL.createObjectURL(file)
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return url
    })
    setImageData(await prepareImage(file))
  }

  function resetAll() {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl('')
    setImageData('')
    setData(null)
    setError('')
    setPhase('idle')
    setProvider(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function analyze(selectedProvider: Provider) {
    if (!imageData) return

    setProvider(selectedProvider)
    setPhase('processing')
    setError('')
    setData(null)

    try {
      const response = await fetch('/api/benchmark-identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, provider: selectedProvider }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '辨識服務暫時無法使用')
      setData(body)
      setPhase('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '發生未知錯誤')
      setPhase('error')
    }
  }

  const diagnosticSections = data
    ? ([
        ['直接看到的資訊', data.result.diagnostic.visual_observations],
        ['制式判斷依據', data.result.diagnostic.evidence_for_system],
        ['尺寸判斷依據', data.result.diagnostic.evidence_for_size],
        ['反證與疑點', data.result.diagnostic.evidence_against_best_spec],
        ['決勝依據', data.result.diagnostic.decisive_evidence],
        ['可能誤判來源', data.result.diagnostic.possible_failure_modes],
      ] as const)
    : []

  const activeProvider = data?.provider ?? provider

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-border py-5">
          <div>
            <p className="text-base font-semibold tracking-tight">HCSI 螺絲辨識測試</p>
            <p className="mt-0.5 text-xs text-muted-foreground">同一張照片，直接比較不同視覺模型的原始判斷</p>
          </div>
          {imageUrl && (
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
              清除
            </button>
          )}
        </header>

        <section className="py-7">
          <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                {!imageUrl ? (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex min-h-[360px] w-full flex-col items-center justify-center gap-4 p-8 text-center transition hover:bg-muted/40"
                  >
                    <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Camera size={24} />
                    </span>
                    <div>
                      <p className="font-semibold">上傳一張螺絲照片</p>
                      <p className="mt-1 text-sm text-muted-foreground">保留原始構圖與照片中的比例尺</p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
                      <Upload size={15} />
                      選擇圖片
                    </span>
                  </button>
                ) : (
                  <div>
                    <div className="relative bg-muted/25">
                      <img
                        src={imageUrl}
                        alt="待辨識螺絲"
                        className="max-h-[430px] min-h-[300px] w-full object-contain p-3"
                      />
                      <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur">
                        <FileImage size={13} />
                        測試圖片
                      </div>
                      <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="absolute right-3 top-3 grid size-9 place-items-center rounded-md bg-background/90 shadow-sm backdrop-blur transition hover:bg-background"
                        aria-label="更換圖片"
                      >
                        <RotateCcw size={16} />
                      </button>
                    </div>
                  </div>
                )}
                <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={handleFile} />
              </div>

              {imageUrl && (
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">選擇模型</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(providerMeta) as Provider[]).map((item) => {
                      const isLoading = phase === 'processing' && provider === item
                      const isActive = activeProvider === item && phase !== 'error'
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => analyze(item)}
                          disabled={phase === 'processing'}
                          className={`rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            isActive
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background hover:border-foreground/25 hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            {providerMeta[item].name}
                          </div>
                          <p className={`mt-1 text-[10px] ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                            {providerMeta[item].note}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div aria-live="polite" className="min-w-0">
              {!data && phase === 'idle' && (
                <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
                  <div className="max-w-sm">
                    <Sparkles className="mx-auto text-muted-foreground" size={22} />
                    <p className="mt-3 text-sm font-medium">結果會顯示在這裡</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      上傳照片後選擇 OpenAI、Gemini 或 Grok。每次只分析目前這張圖片。
                    </p>
                  </div>
                </div>
              )}

              {phase === 'processing' && activeProvider && (
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full bg-muted">
                      <Loader2 className="animate-spin" size={18} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{providerMeta[activeProvider].name} 正在分析</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">等待模型完成圖片判讀與診斷輸出。</p>
                    </div>
                  </div>
                </div>
              )}

              {phase === 'error' && (
                <div className="rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm">
                  <div className="flex gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
                    <div>
                      <p className="text-sm font-semibold">辨識未完成</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {data && (
                <div className="space-y-4">
                  <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        {providerMeta[data.provider].name}
                      </span>
                      <span className="text-xs text-muted-foreground">最終判斷</span>
                    </div>
                    <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                      {data.result.best_spec}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{data.result.conclusion}</p>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <InfoCard label="螺紋制式" value={data.result.thread_system} />
                    <InfoCard label="最接近競爭規格" value={data.result.closest_competitor} />
                    <InfoCard label="關鍵差異" value={data.result.key_difference} className="sm:col-span-2" />
                    <InfoCard label="尺寸目測" value={data.result.size_estimate} className="sm:col-span-2" />
                  </section>

                  <section className="rounded-2xl border border-border bg-card shadow-sm">
                    <div className="border-b border-border px-5 py-4 sm:px-6">
                      <h2 className="text-sm font-semibold">判斷依據</h2>
                      <p className="mt-1 text-xs text-muted-foreground">用來比較模型是在哪個觀察或推論環節開始偏離。</p>
                    </div>
                    <div className="divide-y divide-border">
                      {diagnosticSections.map(([title, items]) => (
                        <div key={title} className="px-5 py-4 sm:px-6">
                          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
                          {items?.length ? (
                            <ul className="mt-2 space-y-1.5 text-sm leading-6">
                              {items.map((item, index) => (
                                <li key={index} className="flex gap-2">
                                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-sm text-muted-foreground">無</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <details className="group rounded-2xl border border-border bg-card shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold sm:px-6">
                      原始模型輸出
                      <ChevronDown size={16} className="text-muted-foreground transition group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border px-5 py-4 sm:px-6">
                      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-4 text-xs leading-5 text-muted-foreground">
                        {data.raw_output}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function InfoCard({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-sm leading-6">{value}</p>
    </div>
  )
}

function prepareImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1600 / image.width, 1600 / image.height)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('無法處理影像'))
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, width, height)
      const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
      URL.revokeObjectURL(image.src)
      resolve(base64)
    }
    image.onerror = () => reject(new Error('影像讀取失敗'))
    image.src = URL.createObjectURL(file)
  })
}

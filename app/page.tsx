'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, FileImage, Loader2, RotateCcw, ScanLine, Sparkles, Upload, X } from 'lucide-react'

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

export default function Page() {
  const [imageUrl, setImageUrl] = useState('')
  const [imageData, setImageData] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(''); setData(null); setPhase('idle')
    const url = URL.createObjectURL(file)
    setImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url })
    setImageData(await prepareImage(file))
  }

  function resetAll() {
    setImageUrl(''); setImageData(''); setData(null); setError(''); setPhase('idle'); setProvider(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function analyze(selectedProvider: Provider) {
    if (!imageData) return
    setProvider(selectedProvider); setPhase('processing'); setError('')
    try {
      const response = await fetch('/api/benchmark-identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, provider: selectedProvider }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '辨識服務暫時無法使用')
      setData(body); setPhase('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '發生未知錯誤'); setPhase('error')
    }
  }

  const diagnosticSections = data ? [
    ['直接可見', data.result.diagnostic.visual_observations],
    ['為何偏向此制式', data.result.diagnostic.evidence_for_system],
    ['為何偏向此尺寸', data.result.diagnostic.evidence_for_size],
    ['不符合／反證', data.result.diagnostic.evidence_against_best_spec],
    ['真正決勝證據', data.result.diagnostic.decisive_evidence],
    ['可能誤判來源', data.result.diagnostic.possible_failure_modes],
  ] as const : []

  const providerLabel = data?.provider === 'openai' ? 'OPENAI' : data?.provider === 'xai' ? 'XAI / GROK' : 'GEMINI'

  return <main className="min-h-screen bg-background text-foreground"><div className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
    <header className="flex items-center justify-between border-b border-border py-5"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><ScanLine size={19}/></div><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">HCSI / NAKED DIAGNOSTIC</p><p className="text-sm font-semibold">裸測＋判斷依據</p></div></div></header>

    <section className="py-9"><div className="mb-7 max-w-2xl"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">先回到最原始的能力，<span className="text-accent">再看它為什麼判對或判錯。</span></h1><p className="mt-3 text-sm leading-6 text-muted-foreground">沒有 reference、CV、預處理、候選表或前一輪狀態。只送一張照片給模型，另外要求它輸出可檢驗的觀察、判斷依據、反證與可能誤判來源。</p></div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {!imageUrl ? <button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-[320px] w-full flex-col items-center justify-center gap-4 p-8 text-center hover:bg-muted/50"><span className="grid size-14 place-items-center rounded-xl border border-border bg-muted"><Camera size={25}/></span><strong>拍照或上傳零件</strong><span className="text-sm text-muted-foreground">每次測試只有這一張圖</span><span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"><Upload size={15}/>選擇影像</span></button> : <div className="relative"><img src={imageUrl} alt="辨識影像" className="max-h-[420px] min-h-[300px] w-full bg-muted/30 object-contain p-3"/><span className="absolute left-4 top-4 rounded-md bg-primary/90 px-2.5 py-1.5 text-[11px] text-primary-foreground"><FileImage className="mr-1 inline" size={13}/>NAKED TEST</span><button type="button" onClick={() => inputRef.current?.click()} className="absolute right-4 top-4 grid size-9 place-items-center rounded-md bg-primary/90 text-primary-foreground"><RotateCcw size={16}/></button></div>}
          <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={handleFile}/>
          {imageUrl && <div className="border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">ONE IMAGE ONLY · NO REFERENCE · NO CV · NO PREPROCESSING</div>}
          {imageUrl && <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-3"><button onClick={() => analyze('gemini')} disabled={phase === 'processing'} className="flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold disabled:opacity-60">{phase === 'processing' && provider === 'gemini' ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>}Gemini 裸測</button><button onClick={() => analyze('openai')} disabled={phase === 'processing'} className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-semibold disabled:opacity-60">{phase === 'processing' && provider === 'openai' ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>}OpenAI 裸測</button><button onClick={() => analyze('xai')} disabled={phase === 'processing'} className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-semibold disabled:opacity-60">{phase === 'processing' && provider === 'xai' ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>}Grok 裸測</button></div>}
        </div>

        <div aria-live="polite">
          {!data && phase !== 'error' && phase !== 'processing' && <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm leading-6 text-muted-foreground">這版不嘗試幫模型量。<br/>目的是直接觀察它原生判斷從哪裡開始偏掉。</div>}
          {phase === 'processing' && <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5"><Loader2 className="animate-spin text-accent" size={18}/><div><p className="text-sm font-semibold">正在裸測</p><p className="text-xs text-muted-foreground">單次模型呼叫、單張原始照片。</p></div></div>}
          {data && <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5"><p className="text-xs font-semibold text-accent">{providerLabel} 最終判斷</p><h2 className="mt-3 text-xl font-semibold leading-7">{data.result.best_spec}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{data.result.conclusion}</p></div>
            <div className="rounded-xl border border-border bg-card p-5 text-sm leading-6"><div><span className="text-muted-foreground">制式：</span>{data.result.thread_system}</div><div className="mt-2"><span className="text-muted-foreground">最接近競爭規格：</span>{data.result.closest_competitor}</div><div className="mt-2"><span className="text-muted-foreground">關鍵差異：</span>{data.result.key_difference}</div><div className="mt-2"><span className="text-muted-foreground">尺寸目測：</span>{data.result.size_estimate}</div></div>
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5"><h3 className="text-sm font-semibold">DIAGNOSTIC · 可檢驗判斷依據</h3><div className="mt-4 space-y-4">{diagnosticSections.map(([title, items]) => <div key={title}><p className="text-xs font-semibold text-muted-foreground">{title}</p>{items?.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">無</p>}</div>)}</div></div>
            <details className="rounded-xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-semibold">RAW MODEL OUTPUT</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{data.raw_output}</pre></details>
            <button type="button" onClick={resetAll} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><X size={14}/>開始另一個裸測</button>
          </div>}
          {phase === 'error' && <div className="flex gap-3 rounded-xl border border-destructive/30 bg-card p-5 text-sm"><AlertCircle size={18} className="shrink-0 text-destructive"/><div><p className="font-semibold">辨識未完成</p><p className="mt-1 text-muted-foreground">{error}</p></div></div>}
        </div>
      </div>
    </section>
  </div></main>
}

function prepareImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1600 / image.width, 1600 / image.height)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('無法處理影像'))
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, width, height)
      const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
      URL.revokeObjectURL(image.src); resolve(base64)
    }
    image.onerror = () => reject(new Error('影像讀取失敗'))
    image.src = URL.createObjectURL(file)
  })
}

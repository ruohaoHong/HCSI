'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, Check, ChevronRight, FileImage, Loader2, RotateCcw, ScanLine, Sparkles, Upload, X } from 'lucide-react'

type Phase = 'idle' | 'processing' | 'success' | 'error'
type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'inferred' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
type IdentificationState = {
  round: number
  purchase_ready: boolean
  purchase_spec: string
  fields: Record<string, FieldValue>
  missing_for_purchase: string[]
  next_action: { type: string; instruction: string } | null
  summary: string
}

const fieldLabels: Record<string, string> = {
  part_type: '零件類型', thread_system: '制式／螺紋系統', nominal_size: '公稱尺寸', length: '長度',
  pitch_tpi: '牙距／TPI', head_type: '頭型', drive: '驅動方式', material_finish: '材質／表面處理',
}

export default function Page() {
  const [imageUrl, setImageUrl] = useState('')
  const [imageData, setImageData] = useState('')
  const [originalImageData, setOriginalImageData] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [state, setState] = useState<IdentificationState | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setPhase('idle')
    const previewUrl = URL.createObjectURL(file)
    setImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return previewUrl })
    const compressed = await compressImage(file)
    setImageData(compressed)
    if (!state) setOriginalImageData(compressed)
  }

  function resetAll() {
    setImageUrl(''); setImageData(''); setOriginalImageData(''); setState(null); setError(''); setPhase('idle'); setProvider(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function analyze(selectedProvider: Provider) {
    if (!imageData) return
    setProvider(selectedProvider); setPhase('processing'); setError('')
    try {
      const response = await fetch('/api/benchmark-identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, original_image: state ? originalImageData : '', provider: selectedProvider, previous_state: state }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '辨識服務暫時無法使用')
      setState(data.state); setPhase('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '發生未知錯誤'); setPhase('error')
    }
  }

  const continuing = Boolean(state && !state.purchase_ready && state.next_action)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
        <header className="flex items-center justify-between border-b border-border py-5">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><ScanLine size={19} /></div><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">HCSI / PROGRESSIVE TEST</p><p className="text-sm font-semibold">漸進式五金辨識</p></div></div>
          {state && <span className="font-mono text-[10px] text-muted-foreground">ROUND {state.round} / 3</span>}
        </header>

        <section className="py-9">
          <div className="mb-7 max-w-2xl"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">先判斷能判斷的，<span className="text-accent">缺什麼才補什麼。</span></h1><p className="mt-3 text-sm leading-6 text-muted-foreground">第一輪只需一張照片。若目前資訊已足以購買，辨識會直接完成；不足時只要求一個最小追加證據。</p></div>

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {!imageUrl ? <button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-[320px] w-full flex-col items-center justify-center gap-4 p-8 text-center hover:bg-muted/50"><span className="grid size-14 place-items-center rounded-xl border border-border bg-muted"><Camera size={25} /></span><strong>{continuing ? '上傳追加證據照片' : '拍照或上傳零件'}</strong><span className="text-sm text-muted-foreground">JPG、PNG · 影像會自動最佳化</span><span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"><Upload size={15} />選擇影像</span></button> : <div className="relative"><img src={imageUrl} alt="辨識影像" className="max-h-[420px] min-h-[300px] w-full bg-muted/30 object-contain p-3" /><span className="absolute left-4 top-4 flex items-center gap-2 rounded-md bg-primary/90 px-2.5 py-1.5 font-mono text-[10px] text-primary-foreground"><FileImage size={13} />{state ? '本輪追加影像' : '第一輪影像'}</span><button type="button" onClick={() => inputRef.current?.click()} className="absolute right-4 top-4 grid size-9 place-items-center rounded-md bg-primary/90 text-primary-foreground"><RotateCcw size={16} /></button></div>}
              <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={handleFile} />
              {imageUrl && <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-2"><button onClick={() => analyze('gemini')} disabled={phase === 'processing'} className="flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-60">{phase === 'processing' && provider === 'gemini' ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}Gemini {state ? '繼續判斷' : '開始辨識'}</button><button onClick={() => analyze('openai')} disabled={phase === 'processing'} className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-semibold disabled:opacity-60">{phase === 'processing' && provider === 'openai' ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}OpenAI {state ? '繼續判斷' : '開始辨識'}</button></div>}
            </div>

            <div aria-live="polite">
              {!state && phase !== 'error' && <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm leading-6 text-muted-foreground">上傳普通照片後開始第一輪。<br />不需要先量尺寸或準備參照物。</div>}
              {phase === 'processing' && <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card p-5"><Loader2 className="animate-spin text-accent" size={18} /><div><p className="text-sm font-semibold">正在更新辨識狀態</p><p className="text-xs text-muted-foreground">只處理目前仍需要的資訊。</p></div></div>}
              {state && <div className="space-y-4">
                <div className={`rounded-xl border p-5 ${state.purchase_ready ? 'border-accent/40 bg-card' : 'border-border bg-card'}`}><div className="flex items-center gap-2"><Check size={18} className="text-accent" /><span className="font-mono text-[10px] uppercase tracking-widest text-accent">{state.purchase_ready ? 'Purchase ready · stop' : 'Current purchase spec'}</span></div><h2 className="mt-3 text-xl font-semibold leading-7">{state.purchase_spec}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{state.summary}</p></div>

                <div className="rounded-xl border border-border bg-card p-5"><h3 className="text-sm font-semibold">目前辨識欄位</h3><div className="mt-4 space-y-2">{Object.entries(state.fields).map(([key, field]) => <div key={key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 border-b border-border/60 py-2 text-sm last:border-0"><span className="text-muted-foreground">{fieldLabels[key] || key}</span><span>{field.value || '尚未確認'}</span><span className="font-mono text-[9px] uppercase text-muted-foreground">{field.status}</span></div>)}</div></div>

                {state.purchase_ready ? <div className="rounded-xl border border-accent/30 bg-accent/5 p-5"><p className="font-semibold">資訊已足以購買，辨識停止。</p><p className="mt-1 text-sm text-muted-foreground">不再要求額外量測或補拍。</p></div> : <div className="rounded-xl border border-border bg-card p-5"><h3 className="text-sm font-semibold">要購買相同規格，目前還缺</h3><p className="mt-2 text-sm leading-6">{state.missing_for_purchase.length ? state.missing_for_purchase.map((item) => fieldLabels[item] || item).join('、') : '沒有明確缺失欄位'}</p>{state.next_action ? <div className="mt-4 rounded-lg bg-muted p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">下一個最小步驟</p><p className="mt-2 text-sm leading-6">{state.next_action.instruction}</p><button type="button" onClick={() => inputRef.current?.click()} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">補一張照片 <ChevronRight size={15} /></button></div> : <p className="mt-3 text-sm text-muted-foreground">已達三輪上限，不再要求更多資訊；以上為目前最佳判斷。</p>}</div>}
                <button type="button" onClick={resetAll} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><X size={14} />開始辨識另一個零件</button>
              </div>}
              {phase === 'error' && <div className="flex gap-3 rounded-xl border border-destructive/30 bg-card p-5 text-sm"><AlertCircle size={18} className="shrink-0 text-destructive" /><div><p className="font-semibold">辨識未完成</p><p className="mt-1 text-muted-foreground">{error}</p></div></div>}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { const scale = Math.min(1, 1280 / image.width); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); const context = canvas.getContext('2d'); if (!context) return reject(new Error('無法處理影像')); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]); URL.revokeObjectURL(image.src) }; image.onerror = () => reject(new Error('影像讀取失敗')); image.src = URL.createObjectURL(file) })
}

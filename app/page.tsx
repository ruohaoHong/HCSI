'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, FileImage, Loader2, RotateCcw, ScanLine, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'

type Phase = 'idle' | 'processing' | 'success' | 'error'
type Provider = 'gemini' | 'openai'

const sampleResult = `零件種類：六角法蘭螺栓
預估尺寸規格：M8 × 35 mm；螺距約 1.25 mm；頭部對邊約 13 mm
材質／外觀特徵：疑似碳鋼鍍鋅，表面呈銀灰色，具規則六角頭與法蘭面
判讀信心：中高。建議以游標卡尺及螺紋規再次確認。`

export default function Page() {
  const [imageUrl, setImageUrl] = useState('')
  const [imageData, setImageData] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setResult('')
    setPhase('idle')
    setProvider(null)
    const previewUrl = URL.createObjectURL(file)
    setImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return previewUrl })
    const compressed = await compressImage(file)
    setImageData(compressed)
  }

  function clearImage() {
    setImageUrl('')
    setImageData('')
    setResult('')
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
    try {
      const endpoint = selectedProvider === 'openai' ? '/api/analyze-openai' : '/api/analyze'
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageData }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '辨識服務暫時無法使用')
      setResult(data.result)
      setPhase('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '發生未知錯誤，請稍後再試')
      setPhase('error')
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-10 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-border py-5">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><ScanLine size={19} /></div><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">FIELD TOOL / 01</p><p className="text-sm font-semibold tracking-tight">尺寸辨識工作台</p></div></div>
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-accent" />AI 視覺分析</div>
        </header>

        <section className="grid flex-1 gap-10 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-20 lg:py-16">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"><span className="size-1.5 rounded-full bg-accent" /> 工程現場工具</div>
            <div className="space-y-4"><h1 className="max-w-xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-5xl lg:text-6xl">五金元件<br /><span className="text-accent">尺寸辨識</span></h1><p className="max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base">拍下零件，讓 AI 協助判讀種類、規格與材質。適合現場盤點、採購核對與維修紀錄。</p></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><span>01 / 拍攝</span><ChevronRight size={13} /><span>02 / 分析</span><ChevronRight size={13} /><span>03 / 確認</span></div>
          </div>

          <div className="relative">
            <div className="absolute -inset-2 rounded-2xl border border-accent/20" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-primary/5">
              {!imageUrl ? <button type="button" onClick={() => inputRef.current?.click()} className="group flex min-h-[330px] w-full flex-col items-center justify-center gap-5 p-8 text-center transition-colors hover:bg-muted/50 sm:min-h-[390px]"><span className="grid size-16 place-items-center rounded-2xl border border-border bg-muted text-muted-foreground transition-all group-hover:border-accent group-hover:bg-accent/10 group-hover:text-accent"><Camera size={28} strokeWidth={1.5} /></span><span><strong className="block text-base font-semibold">拍照或上傳零件</strong><span className="mt-1 block text-sm text-muted-foreground">支援 JPG、PNG · 自動最佳化影像</span></span><span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"><Upload size={15} /> 選擇影像</span></button> : <div className="relative"><img src={imageUrl} alt="待辨識的五金零件預覽" className="max-h-[460px] min-h-[300px] w-full object-contain bg-muted/30 p-3" /><div className="absolute left-5 top-5 flex items-center gap-2 rounded-md bg-primary/90 px-2.5 py-1.5 font-mono text-[10px] text-primary-foreground"><FileImage size={13} /> 已載入影像</div><button type="button" onClick={clearImage} aria-label="清除影像" className="absolute right-5 top-5 grid size-9 place-items-center rounded-md bg-primary/90 text-primary-foreground transition-colors hover:bg-accent"><X size={17} /></button></div>}
              <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={handleFile} />
              {imageUrl && <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row"><button type="button" onClick={() => inputRef.current?.click()} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"><RotateCcw size={15} /> 重新拍攝</button><button type="button" onClick={() => analyze('gemini')} disabled={phase === 'processing'} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-all hover:brightness-95 disabled:cursor-wait disabled:opacity-70">{phase === 'processing' && provider === 'gemini' ? <><Loader2 size={16} className="animate-spin" /> Gemini 分析中...</> : <><Sparkles size={16} /> Gemini 分析 <ArrowUpRight size={15} /></>}</button><button type="button" onClick={() => analyze('openai')} disabled={phase === 'processing'} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70">{phase === 'processing' && provider === 'openai' ? <><Loader2 size={16} className="animate-spin" /> OpenAI 分析中...</> : <><Sparkles size={16} /> OpenAI 分析 <ArrowUpRight size={15} /></>}</button></div>}
            </div>
          </div>
        </section>

        <section aria-live="polite" className="pb-10">{phase === 'processing' && <div className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center gap-3"><div className="grid size-8 place-items-center rounded-full bg-accent/15 text-accent"><Loader2 size={16} className="animate-spin" /></div><div><p className="text-sm font-semibold">{provider === 'openai' ? 'OpenAI' : 'Gemini'} 正在檢視元件特徵</p><p className="text-xs text-muted-foreground">比對形狀、比例與表面特徵...</p></div></div><div className="space-y-2"><div className="h-2 animate-pulse rounded bg-muted" /><div className="h-2 w-4/5 animate-pulse rounded bg-muted" /></div></div>}{phase === 'success' && <div className="result-card rounded-xl border border-accent/30 bg-card p-5 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-accent/15 text-accent"><Check size={18} /></div><div><p className="font-mono text-[10px] uppercase tracking-widest text-accent">Analysis complete</p><h2 className="mt-1 text-lg font-semibold">{provider === 'openai' ? 'OpenAI' : 'Gemini'} 辨識結果</h2></div></div><ShieldCheck size={19} className="text-muted-foreground" aria-label="安全輸出" /></div><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-card-foreground">{result || sampleResult}</pre><p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">AI 辨識結果僅供參考，實際尺寸請使用量具確認。</p></div>}{phase === 'error' && <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-card p-5 text-sm"><AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" /><div><p className="font-semibold">辨識未完成</p><p className="mt-1 text-muted-foreground">{error}</p></div></div>}</section>
        <footer className="flex flex-col gap-3 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2"><CircleHelp size={14} /> 建議在光線充足、背景單純的環境拍攝</span><span className="font-mono text-[10px] uppercase tracking-wider">HARDWARE / VISION LAB</span></footer>
      </div>
    </main>
  )
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { const scale = Math.min(1, 1280 / image.width); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); const context = canvas.getContext('2d'); if (!context) return reject(new Error('無法處理影像')); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]); }; image.onerror = () => reject(new Error('影像讀取失敗')); image.src = URL.createObjectURL(file) })
}

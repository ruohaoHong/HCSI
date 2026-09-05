import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '五金元件尺寸辨識｜Hardware Vision Lab',
  description: '以 AI 協助辨識五金元件種類、尺寸規格與材質特徵。',
  generator: 'v0.app',
}

export const viewport: Viewport = { colorScheme: 'light', themeColor: '#f4f3ee', width: 'device-width', initialScale: 1, userScalable: true }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant" className="bg-background"><body className="antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body></html>
}

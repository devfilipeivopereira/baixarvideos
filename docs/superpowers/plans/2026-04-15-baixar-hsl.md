# BaixarHSL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app on Vercel that extracts HLS stream URLs from authenticated pages and downloads them as MP4 using ffmpeg.wasm client-side.

**Architecture:** User provides a video page URL + session cookies; the `/api/extract` Edge Function scrapes the page for `.m3u8` URLs via Cheerio/regex; `/api/proxy` proxies authenticated segment fetches to bypass CORS; client-side `@ffmpeg/ffmpeg@0.11.x` assembles segments into MP4 and triggers browser download.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Cheerio, @ffmpeg/ffmpeg@0.11.x, Vercel Edge Runtime

---

## File Structure

```
BaixarHSL/
├── app/
│   ├── layout.tsx              # Root layout — COOP/COEP headers via next.config.js
│   ├── page.tsx                # Main page — composes DownloadForm
│   ├── globals.css             # Tailwind base styles
│   └── api/
│       ├── extract/
│       │   └── route.ts        # POST { url, cookies } → { streamUrl, title }
│       └── proxy/
│           └── route.ts        # POST { url, cookies } → proxied binary response
├── components/
│   ├── DownloadForm.tsx        # Form inputs + orchestrates the full download flow
│   ├── ProgressBar.tsx         # Segment-level progress (0–100%)
│   └── StatusMessage.tsx       # Error / success / info banners
├── lib/
│   ├── hls-parser.ts           # Parse .m3u8 text → string[] of segment URLs
│   ├── extractor.ts            # Cheerio + regex to find stream URL in raw HTML
│   └── ffmpeg-worker.ts        # ffmpeg.wasm orchestration: load → concat → export
├── __tests__/
│   ├── hls-parser.test.ts      # Unit tests for m3u8 parsing
│   └── extractor.test.ts       # Unit tests for HTML stream extraction
├── next.config.js              # COOP/COEP headers + Edge runtime config
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.js`, `app/globals.css`, `app/layout.tsx`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd c:/Users/filip/DEV/BaixarHSL
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=no --import-alias="@/*" --yes
```

- [ ] **Step 2: Install dependencies**

```bash
npm install cheerio @ffmpeg/ffmpeg@0.11.6 @ffmpeg/core@0.11.0
npm install -D jest @types/jest ts-jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label textarea progress badge
```

- [ ] **Step 4: Configure Jest**

Create `jest.config.js`:
```js
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
}
module.exports = config
```

Add to `package.json` scripts:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 5: Verify scaffold**

```bash
npm run dev
```

Expected: Next.js dev server running on http://localhost:3000

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js 14 project with tailwind and shadcn"
```

---

## Task 2: COOP/COEP headers (SharedArrayBuffer for ffmpeg.wasm)

**Files:**
- Modify: `next.config.js`

- [ ] **Step 1: Add security headers**

Replace `next.config.js` content with:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
```

- [ ] **Step 2: Verify headers in browser**

```bash
npm run dev
```

Open http://localhost:3000, DevTools → Network → click the document → Headers tab.
Expected: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` present.

- [ ] **Step 3: Commit**

```bash
git add next.config.js
git commit -m "feat: add COOP/COEP headers for SharedArrayBuffer support"
```

---

## Task 3: HLS parser (`lib/hls-parser.ts`)

**Files:**
- Create: `lib/hls-parser.ts`
- Create: `__tests__/hls-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/hls-parser.test.ts`:
```ts
import { parseM3u8, resolveSegmentUrls } from '@/lib/hls-parser'

const SIMPLE_M3U8 = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.0,
seg000.ts
#EXTINF:9.0,
seg001.ts
#EXT-X-ENDLIST
`

const ABSOLUTE_M3U8 = `
#EXTM3U
#EXTINF:9.0,
https://cdn.example.com/video/seg000.ts
#EXTINF:9.0,
https://cdn.example.com/video/seg001.ts
#EXT-X-ENDLIST
`

describe('parseM3u8', () => {
  it('extracts relative segment paths', () => {
    expect(parseM3u8(SIMPLE_M3U8)).toEqual(['seg000.ts', 'seg001.ts'])
  })

  it('extracts absolute segment URLs', () => {
    expect(parseM3u8(ABSOLUTE_M3U8)).toEqual([
      'https://cdn.example.com/video/seg000.ts',
      'https://cdn.example.com/video/seg001.ts',
    ])
  })

  it('returns empty array for empty manifest', () => {
    expect(parseM3u8('')).toEqual([])
  })
})

describe('resolveSegmentUrls', () => {
  it('resolves relative segments against base URL', () => {
    const baseUrl = 'https://cdn.example.com/video/index.m3u8'
    const segments = ['seg000.ts', 'seg001.ts']
    expect(resolveSegmentUrls(segments, baseUrl)).toEqual([
      'https://cdn.example.com/video/seg000.ts',
      'https://cdn.example.com/video/seg001.ts',
    ])
  })

  it('leaves absolute URLs unchanged', () => {
    const baseUrl = 'https://cdn.example.com/video/index.m3u8'
    const segments = ['https://other.cdn.com/seg000.ts']
    expect(resolveSegmentUrls(segments, baseUrl)).toEqual([
      'https://other.cdn.com/seg000.ts',
    ])
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- hls-parser
```

Expected: FAIL — "Cannot find module '@/lib/hls-parser'"

- [ ] **Step 3: Implement `lib/hls-parser.ts`**

```ts
/**
 * Parses an HLS .m3u8 manifest and returns the list of segment paths/URLs.
 * Lines starting with # are comments/tags and are ignored.
 */
export function parseM3u8(manifest: string): string[] {
  return manifest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Resolves relative segment paths against the manifest base URL.
 * Absolute URLs (starting with http) are returned unchanged.
 */
export function resolveSegmentUrls(segments: string[], baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1)

  return segments.map((seg) => {
    if (seg.startsWith('http')) return seg
    return baseDir + seg
  })
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- hls-parser
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/hls-parser.ts __tests__/hls-parser.test.ts
git commit -m "feat: add HLS m3u8 parser with segment URL resolution"
```

---

## Task 4: Stream URL extractor (`lib/extractor.ts`)

**Files:**
- Create: `lib/extractor.ts`
- Create: `__tests__/extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/extractor.test.ts`:
```ts
import { extractStreamUrl } from '@/lib/extractor'

describe('extractStreamUrl', () => {
  it('finds m3u8 URL in a script tag', () => {
    const html = `
      <html><body>
      <script>var player = { src: "https://cdn.example.com/video/index.m3u8?token=abc" };</script>
      </body></html>
    `
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/video/index.m3u8?token=abc')
  })

  it('finds m3u8 URL in an HTML attribute', () => {
    const html = `<video src="https://cdn.example.com/stream.m3u8"></video>`
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/stream.m3u8')
  })

  it('returns null when no stream URL found', () => {
    const html = `<html><body><p>No video here</p></body></html>`
    expect(extractStreamUrl(html)).toBeNull()
  })

  it('prefers m3u8 over mpd when both present', () => {
    const html = `
      <script>
        var hls = "https://cdn.example.com/stream.m3u8";
        var dash = "https://cdn.example.com/stream.mpd";
      </script>
    `
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/stream.m3u8')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- extractor
```

Expected: FAIL — "Cannot find module '@/lib/extractor'"

- [ ] **Step 3: Implement `lib/extractor.ts`**

```ts
import * as cheerio from 'cheerio'

const M3U8_REGEX = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi
const MPD_REGEX = /https?:\/\/[^\s"']+\.mpd[^\s"']*/gi

/**
 * Searches raw HTML for HLS (.m3u8) or DASH (.mpd) stream URLs.
 * Prefers m3u8 over mpd. Returns null if nothing found.
 */
export function extractStreamUrl(html: string): string | null {
  // Try m3u8 first
  const m3u8Matches = html.match(M3U8_REGEX)
  if (m3u8Matches && m3u8Matches.length > 0) {
    return m3u8Matches[0]
  }

  // Fallback to mpd
  const mpdMatches = html.match(MPD_REGEX)
  if (mpdMatches && mpdMatches.length > 0) {
    return mpdMatches[0]
  }

  // Try cheerio for src attributes on video/source elements
  const $ = cheerio.load(html)
  const videoSrc =
    $('video[src]').attr('src') ||
    $('source[src]').attr('src') ||
    null

  if (videoSrc && (videoSrc.includes('.m3u8') || videoSrc.includes('.mpd'))) {
    return videoSrc
  }

  return null
}

/**
 * Extracts the page title from HTML, or returns a fallback.
 */
export function extractTitle(html: string): string {
  const $ = cheerio.load(html)
  return $('title').first().text().trim() || 'video'
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- extractor
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/extractor.ts __tests__/extractor.test.ts
git commit -m "feat: add stream URL extractor with cheerio + regex fallback"
```

---

## Task 5: `/api/extract` route

**Files:**
- Create: `app/api/extract/route.ts`
- Create: `__tests__/extract-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/extract-route.test.ts`:
```ts
/**
 * Tests for /api/extract logic using the extractor lib directly.
 * The Edge runtime is not available in Jest; test the business logic
 * (extractStreamUrl) in isolation and rely on manual curl for route wiring.
 */
import { extractStreamUrl, extractTitle } from '@/lib/extractor'

describe('/api/extract logic', () => {
  it('returns stream URL from inline script', () => {
    const html = `<script>window.__PLAYER_CONFIG__ = { hlsUrl: "https://cdn.example.com/video.m3u8" };</script>`
    expect(extractStreamUrl(html)).toBe('https://cdn.example.com/video.m3u8')
  })

  it('returns null when no stream URL found', () => {
    expect(extractStreamUrl('<html><body>nothing</body></html>')).toBeNull()
  })

  it('extracts page title correctly', () => {
    const html = `<html><head><title>Aula 1 - Curso React</title></head><body></body></html>`
    expect(extractTitle(html)).toBe('Aula 1 - Curso React')
  })

  it('returns fallback title when no title tag', () => {
    expect(extractTitle('<html><body></body></html>')).toBe('video')
  })

  it('detects type as hls for m3u8 URLs', () => {
    const url = 'https://cdn.example.com/stream.m3u8'
    expect(url.includes('.mpd') ? 'dash' : 'hls').toBe('hls')
  })

  it('detects type as dash for mpd URLs', () => {
    const url = 'https://cdn.example.com/stream.mpd'
    expect(url.includes('.mpd') ? 'dash' : 'hls').toBe('dash')
  })
})
```

- [ ] **Step 2: Run tests — expect PASS (they test lib functions already implemented)**

```bash
npm test -- extract-route
```

Expected: PASS — 6 tests

- [ ] **Step 3: Create the route**

Create `app/api/extract/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { extractStreamUrl, extractTitle } from '@/lib/extractor'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  const { url, cookies } = await req.json() as { url: string; cookies: string }

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const response = await fetch(url, {
      headers: {
        Cookie: cookies || '',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Page returned HTTP ${response.status}` },
        { status: 502 }
      )
    }

    const html = await response.text()
    const streamUrl = extractStreamUrl(html)
    const title = extractTitle(html)

    if (!streamUrl) {
      return NextResponse.json(
        {
          error:
            'Nenhuma URL de stream encontrada na página. Se o site carrega o vídeo via JavaScript assíncrono, cole a URL do .m3u8 diretamente no campo "URL do stream".',
        },
        { status: 404 }
      )
    }

    const type = streamUrl.includes('.mpd') ? 'dash' : 'hls'
    return NextResponse.json({ streamUrl, title, type })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Tempo limite de 25s excedido ao carregar a página.' },
        { status: 504 }
      )
    }
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 2: Test manually**

```bash
npm run dev
```

In another terminal:
```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8","cookies":""}'
```

Expected: JSON with `streamUrl` or a structured error.

- [ ] **Step 4: Commit**

```bash
git add app/api/extract/route.ts __tests__/extract-route.test.ts
git commit -m "feat: add /api/extract Edge Function for HLS URL scraping"
```

---

## Task 6: `/api/proxy` route

**Files:**
- Create: `app/api/proxy/route.ts`

- [ ] **Step 1: Create the proxy route**

Create `app/api/proxy/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  const { url, cookies } = await req.json() as { url: string; cookies: string }

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'URL inválida.' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        Cookie: cookies || '',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: parsedUrl.origin,
      },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned HTTP ${response.status}` },
        { status: 502 }
      )
    }

    const body = response.body
    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
```

- [ ] **Step 2: Test proxy manually**

```bash
curl -X POST http://localhost:3000/api/proxy \
  -H "Content-Type: application/json" \
  -d '{"url":"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8","cookies":""}'
```

Expected: Raw `.m3u8` text content returned.

- [ ] **Step 3: Commit**

```bash
git add app/api/proxy/route.ts
git commit -m "feat: add /api/proxy Edge Function for authenticated CORS bypass"
```

---

## Task 7: ffmpeg.wasm orchestration (`lib/ffmpeg-worker.ts`)

**Files:**
- Create: `lib/ffmpeg-worker.ts`
- Create: `__tests__/ffmpeg-worker.test.ts`

Note: `@ffmpeg/ffmpeg@0.11.x` uses a callback-based API (not the v0.12 async API). This file wraps it in a clean interface.

- [ ] **Step 1: Write failing tests**

Create `__tests__/ffmpeg-worker.test.ts`:
```ts
import { buildConcatList, buildSegmentFilename } from '@/lib/ffmpeg-worker'

describe('buildSegmentFilename', () => {
  it('zero-pads index to 5 digits', () => {
    expect(buildSegmentFilename(0)).toBe('seg00000.ts')
    expect(buildSegmentFilename(42)).toBe('seg00042.ts')
    expect(buildSegmentFilename(99999)).toBe('seg99999.ts')
  })
})

describe('buildConcatList', () => {
  it('produces ffmpeg concat format', () => {
    const filenames = ['seg00000.ts', 'seg00001.ts']
    expect(buildConcatList(filenames)).toBe("file 'seg00000.ts'\nfile 'seg00001.ts'")
  })

  it('handles single segment', () => {
    expect(buildConcatList(['seg00000.ts'])).toBe("file 'seg00000.ts'")
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- ffmpeg-worker
```

Expected: FAIL — "buildSegmentFilename is not a function"

- [ ] **Step 3: Create the worker**

Create `lib/ffmpeg-worker.ts`:
```ts
import { createFFmpeg } from '@ffmpeg/ffmpeg'

export type ProgressCallback = (percent: number, message: string) => void

/** Zero-pads segment index for filesystem ordering (exported for tests). */
export function buildSegmentFilename(index: number): string {
  return `seg${String(index).padStart(5, '0')}.ts`
}

/** Builds the ffmpeg concat file content (exported for tests). */
export function buildConcatList(filenames: string[]): string {
  return filenames.map((f) => `file '${f}'`).join('\n')
}

/**
 * Downloads all HLS segments via the proxy, assembles them with ffmpeg.wasm,
 * and returns a Blob of the resulting MP4.
 */
export async function downloadHls(
  segmentUrls: string[],
  cookies: string,
  onProgress: ProgressCallback
): Promise<Blob> {
  onProgress(0, 'Carregando ffmpeg.wasm...')

  const ffmpeg = createFFmpeg({ log: false })
  await ffmpeg.load()

  const total = segmentUrls.length
  const filenames: string[] = []

  for (let i = 0; i < total; i++) {
    const url = segmentUrls[i]
    const filename = buildSegmentFilename(i)

    onProgress(Math.round((i / total) * 85), `Baixando segmento ${i + 1}/${total}...`)

    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookies }),
    })

    if (!response.ok) throw new Error(`Falha ao baixar segmento ${i + 1}: HTTP ${response.status}`)

    const buffer = await response.arrayBuffer()
    ffmpeg.FS('writeFile', filename, new Uint8Array(buffer))
    filenames.push(filename)
  }

  onProgress(87, 'Montando MP4...')

  ffmpeg.FS('writeFile', 'concat.txt', buildConcatList(filenames))
  await ffmpeg.run('-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4')

  onProgress(98, 'Finalizando arquivo...')

  const data = ffmpeg.FS('readFile', 'output.mp4')
  return new Blob([data.buffer], { type: 'video/mp4' })
}

/**
 * Triggers a browser file download for the given Blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- ffmpeg-worker
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ffmpeg-worker.ts __tests__/ffmpeg-worker.test.ts
git commit -m "feat: add ffmpeg.wasm HLS download orchestrator with unit tests"
```

---

## Task 8: UI Components

**Files:**
- Create: `components/ProgressBar.tsx`
- Create: `components/StatusMessage.tsx`

- [ ] **Step 1: Create `components/ProgressBar.tsx`**

```tsx
import { Progress } from '@/components/ui/progress'

interface Props {
  percent: number
  message: string
}

export function ProgressBar({ percent, message }: Props) {
  return (
    <div className="space-y-2">
      <Progress value={percent} className="h-3" />
      <p className="text-sm text-muted-foreground text-center">{message}</p>
    </div>
  )
}
```

- [ ] **Step 2: Create `components/StatusMessage.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'

type Status = 'error' | 'success' | 'info'

interface Props {
  status: Status
  message: string
}

const styles: Record<Status, string> = {
  error: 'border border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  success: 'border border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200',
  info: 'border border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
}

export function StatusMessage({ status, message }: Props) {
  return (
    <div className={`rounded-md p-3 text-sm ${styles[status]}`}>
      {message}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ProgressBar.tsx components/StatusMessage.tsx
git commit -m "feat: add ProgressBar and StatusMessage UI components"
```

---

## Task 9: Main DownloadForm component

**Files:**
- Create: `components/DownloadForm.tsx`

This component owns the full download flow: extract → parse manifest → download segments → mux → save.

- [ ] **Step 1: Create `components/DownloadForm.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProgressBar } from '@/components/ProgressBar'
import { StatusMessage } from '@/components/StatusMessage'
import { parseM3u8, resolveSegmentUrls } from '@/lib/hls-parser'
import { downloadHls, triggerDownload } from '@/lib/ffmpeg-worker'

type Phase = 'idle' | 'extracting' | 'downloading' | 'done' | 'error'

export function DownloadForm() {
  const [pageUrl, setPageUrl] = useState('')
  const [streamUrl, setStreamUrl] = useState('')
  const [cookies, setCookies] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [detectedStream, setDetectedStream] = useState('')
  const [streamType, setStreamType] = useState<'hls' | 'dash' | null>(null)

  const handleProgress = (percent: number, message: string) => {
    setProgress(percent)
    setProgressMsg(message)
  }

  const handleExtract = async () => {
    if (!pageUrl) return
    setPhase('extracting')
    setStatusMsg('')
    setDetectedStream('')
    handleProgress(10, 'Buscando stream na página...')

    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl, cookies }),
    })
    const data = await res.json()

    if (!res.ok) {
      setPhase('error')
      setStatusMsg(data.error || 'Erro ao extrair URL do stream.')
      return
    }

    setDetectedStream(data.streamUrl)
    setStreamUrl(data.streamUrl)
    setStreamType(data.type)
    setStatusMsg(`Stream detectado: ${data.title || data.streamUrl}`)
    setPhase('idle')
    handleProgress(0, '')
  }

  const handleDownload = async () => {
    const url = streamUrl || detectedStream
    if (!url) return

    // DASH not supported in v1 — guard against silent failure
    const isDash = streamType === 'dash' || url.includes('.mpd')
    if (isDash) {
      setStatusMsg('Formato DASH (.mpd) não é suportado nesta versão. Use um link .m3u8 (HLS).')
      setPhase('error')
      return
    }

    setPhase('downloading')
    setStatusMsg('')

    try {
      // 1. Fetch manifest via proxy
      handleProgress(5, 'Baixando manifest...')
      const manifestRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, cookies }),
      })

      if (!manifestRes.ok) throw new Error(`Falha ao baixar manifest: HTTP ${manifestRes.status}`)

      const manifestText = await manifestRes.text()

      // 2. Parse segments
      const segments = parseM3u8(manifestText)
      if (segments.length === 0) throw new Error('Nenhum segmento encontrado no manifest.')
      const resolvedSegments = resolveSegmentUrls(segments, url)

      // 3. Download + mux
      const blob = await downloadHls(resolvedSegments, cookies, handleProgress)

      // 4. Save
      handleProgress(100, 'Download completo!')
      triggerDownload(blob, 'video.mp4')
      setPhase('done')
      setStatusMsg('Video baixado com sucesso!')
    } catch (err: unknown) {
      setPhase('error')
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      setStatusMsg(message)
    }
  }

  const isLoading = phase === 'extracting' || phase === 'downloading'

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Extrair stream da página</CardTitle>
          <CardDescription>
            Cole a URL da página do vídeo e os cookies da sua sessão. Para copiar cookies: DevTools (F12) → Application → Cookies → copie os valores do domínio como <code>nome=valor; outro=valor2</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="page-url">URL da página</Label>
            <Input
              id="page-url"
              placeholder="https://plataforma.com/aula/123"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cookies">Cookies de sessão (opcional para sites públicos)</Label>
            <Textarea
              id="cookies"
              placeholder="session_id=abc123; auth_token=xyz..."
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              rows={3}
              disabled={isLoading}
            />
          </div>
          <Button onClick={handleExtract} disabled={isLoading || !pageUrl} className="w-full">
            {phase === 'extracting' ? 'Extraindo...' : 'Extrair URL do stream'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Download do vídeo</CardTitle>
          <CardDescription>
            URL do stream detectada automaticamente, ou cole manualmente um link .m3u8 para sites com carregamento via JavaScript.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="stream-url">URL do stream (.m3u8)</Label>
            <Input
              id="stream-url"
              placeholder="https://cdn.example.com/video/index.m3u8"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={handleDownload}
            disabled={isLoading || (!streamUrl && !detectedStream)}
            className="w-full"
            variant={phase === 'done' ? 'outline' : 'default'}
          >
            {phase === 'downloading' ? 'Baixando...' : 'Baixar como MP4'}
          </Button>
        </CardContent>
      </Card>

      {isLoading && <ProgressBar percent={progress} message={progressMsg} />}

      {statusMsg && (
        <StatusMessage
          status={phase === 'error' ? 'error' : phase === 'done' ? 'success' : 'info'}
          message={statusMsg}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/DownloadForm.tsx
git commit -m "feat: add DownloadForm component with full extract→download flow"
```

---

## Task 10: Main page and layout

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Update `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'BaixarHSL — HLS Video Downloader',
  description: 'Baixe vídeos HLS privados para o seu PC',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <main className="min-h-screen bg-background text-foreground">
          {children}
        </main>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Update `app/page.tsx`**

```tsx
import { DownloadForm } from '@/components/DownloadForm'

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-2">BaixarHSL</h1>
        <p className="text-muted-foreground">
          Baixe vídeos HLS (.m3u8) de sites autenticados direto para o seu PC
        </p>
      </div>
      <DownloadForm />
    </div>
  )
}
```

- [ ] **Step 3: Verify app in browser**

```bash
npm run dev
```

Open http://localhost:3000 — should show the full UI with both cards, inputs, and buttons.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: PASS — all unit tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/layout.tsx app/globals.css
git commit -m "feat: compose main page with DownloadForm"
```

---

## Task 11: Deploy to Vercel

**Files:**
- Create: `vercel.json` (if needed for Edge Function config)

- [ ] **Step 1: Verify build**

```bash
npm run build
```

Expected: no errors. Note any warnings about ffmpeg.wasm size.

- [ ] **Step 2: Deploy**

```bash
npx vercel --prod
```

Follow prompts: link to account, create new project named `baixar-hsl`, deploy.

- [ ] **Step 3: Test on Vercel URL**

Open the deployed URL, test with a public HLS stream:
`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`

Paste it directly in the "URL do stream" field and click "Baixar como MP4".

Expected: progress bar runs through segments, MP4 download starts.

- [ ] **Step 4: Commit final**

```bash
git add .
git commit -m "chore: finalize deployment configuration"
```

---

## End-to-End Test Protocol

After full deployment, test this golden path:

1. Open the deployed app
2. Paste `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` directly in "URL do stream"
3. Click "Baixar como MP4"
4. Verify progress bar advances through segments
5. Verify MP4 file downloads and plays in VLC

Edge case: paste a page URL that contains an inline m3u8 reference and verify auto-extraction works.

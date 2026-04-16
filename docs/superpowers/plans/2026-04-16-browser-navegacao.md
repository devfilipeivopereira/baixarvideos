# Navegação Autenticada + Captura de Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao BaixarHSL um painel de navegação com Puppeteer que permite navegar em sites autenticados e capturar automaticamente URLs de stream `.m3u8`.

**Architecture:** `BrowsePanel.tsx` (componente colapsável) chama `POST /api/browse` que usa Puppeteer + `@sparticuz/chromium-min` para renderizar páginas com JS, interceptar respostas `.m3u8` via `page.on('response')` e extrair links do mesmo domínio. O browser é singleton por container (cold-start mitigation). Funções puras de suporte ficam em `lib/browse-helpers.ts` para testabilidade.

**Tech Stack:** Next.js 16 (App Router), `puppeteer-core@21`, `@sparticuz/chromium-min@123`, TypeScript, Tailwind, shadcn/ui, Jest + ts-jest

---

## File Structure

```
lib/
  browse-helpers.ts        # NEW — parseCookiesString, filterLinks, extractDomain
app/api/browse/
  route.ts                 # NEW — POST /api/browse, runtime='nodejs', Puppeteer singleton
components/
  BrowsePanel.tsx          # NEW — painel colapsável de navegação
  DownloadForm.tsx         # MODIFY — adicionar BrowsePanel entre cookies e extração
__tests__/
  browse-helpers.test.ts   # NEW — testes unitários para lib/browse-helpers.ts
```

---

## Task 1: Instalar dependências + `lib/browse-helpers.ts` com testes

**Files:**
- Create: `lib/browse-helpers.ts`
- Create: `__tests__/browse-helpers.test.ts`

- [ ] **Step 1: Instalar dependências**

```bash
cd c:/Users/filip/DEV/BaixarHSL
npm install puppeteer-core@21 @sparticuz/chromium-min@123
```

Expected: `node_modules/puppeteer-core` e `node_modules/@sparticuz` aparecem.

- [ ] **Step 2: Escrever os testes que falharão**

Criar `__tests__/browse-helpers.test.ts`:

```ts
import { parseCookiesString, filterLinks, extractDomain } from '@/lib/browse-helpers'

// ── extractDomain ──────────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts hostname without leading dot', () => {
    expect(extractDomain('https://ead.envisionar.com/courses')).toBe('ead.envisionar.com')
  })

  it('handles localhost correctly (no leading dot)', () => {
    expect(extractDomain('http://localhost:3000/page')).toBe('localhost')
  })

  it('handles subdomains correctly', () => {
    expect(extractDomain('https://sub.example.com/path')).toBe('sub.example.com')
  })
})

// ── parseCookiesString ─────────────────────────────────────────────────────────

describe('parseCookiesString', () => {
  it('parses multiple cookies into array', () => {
    const result = parseCookiesString('a=1; b=2', 'example.com')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'a', value: '1' })
    expect(result[1]).toMatchObject({ name: 'b', value: '2' })
  })

  it('assigns correct domain without leading dot', () => {
    const result = parseCookiesString('session=abc', 'ead.envisionar.com')
    expect(result[0].domain).toBe('ead.envisionar.com')
  })

  it('assigns path / to all cookies', () => {
    const result = parseCookiesString('x=1', 'example.com')
    expect(result[0].path).toBe('/')
  })

  it('returns empty array for empty string', () => {
    expect(parseCookiesString('', 'example.com')).toHaveLength(0)
  })

  it('trims whitespace around name and value', () => {
    const result = parseCookiesString('  key  =  val  ', 'example.com')
    expect(result[0]).toMatchObject({ name: 'key', value: 'val' })
  })
})

// ── filterLinks ────────────────────────────────────────────────────────────────

describe('filterLinks', () => {
  const base = 'https://ead.envisionar.com'

  it('keeps same-domain links', () => {
    const links = [{ text: 'Aula 1', href: 'https://ead.envisionar.com/aula/1' }]
    expect(filterLinks(links, base)).toHaveLength(1)
  })

  it('removes external domain links', () => {
    const links = [{ text: 'Externo', href: 'https://google.com' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes javascript: hrefs', () => {
    const links = [{ text: 'Click', href: 'javascript:void(0)' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes # hrefs', () => {
    const links = [{ text: 'Anchor', href: '#section' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes mailto: hrefs', () => {
    const links = [{ text: 'Email', href: 'mailto:a@b.com' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes file extension links (.pdf)', () => {
    const links = [{ text: 'PDF', href: 'https://ead.envisionar.com/doc.pdf' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes file extension links (.zip)', () => {
    const links = [{ text: 'Zip', href: 'https://ead.envisionar.com/file.zip' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes logout links by text — Sair', () => {
    const links = [{ text: 'Sair', href: 'https://ead.envisionar.com/logout' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes logout links by text — Logout (case-insensitive)', () => {
    const links = [{ text: 'LOGOUT', href: 'https://ead.envisionar.com/logout' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('removes logout links by text — Desconectar', () => {
    const links = [{ text: 'Desconectar', href: 'https://ead.envisionar.com/sair' }]
    expect(filterLinks(links, base)).toHaveLength(0)
  })

  it('deduplicates by href', () => {
    const links = [
      { text: 'Aula 1', href: 'https://ead.envisionar.com/aula/1' },
      { text: 'Aula 1 (dup)', href: 'https://ead.envisionar.com/aula/1' },
    ]
    expect(filterLinks(links, base)).toHaveLength(1)
  })

  it('limits to 200 links', () => {
    const links = Array.from({ length: 250 }, (_, i) => ({
      text: `Link ${i}`,
      href: `https://ead.envisionar.com/page/${i}`,
    }))
    expect(filterLinks(links, base)).toHaveLength(200)
  })
})
```

- [ ] **Step 3: Rodar testes — esperar FAIL**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx jest browse-helpers --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/browse-helpers'"

- [ ] **Step 4: Implementar `lib/browse-helpers.ts`**

```ts
export interface RawLink {
  text: string
  href: string
}

export interface CookieParam {
  name: string
  value: string
  domain: string
  path: string
}

const FILE_EXTENSIONS = ['.pdf', '.zip', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mp3', '.doc', '.docx', '.xls', '.xlsx']
const LOGOUT_KEYWORDS = ['sair', 'logout', 'sign out', 'desconectar']

/**
 * Extracts the hostname from a URL without a leading dot.
 * "https://ead.envisionar.com/courses" → "ead.envisionar.com"
 * "http://localhost:3000" → "localhost"
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Parses a cookie string (name=value; name2=value2) into an array of cookie params.
 * Domain is assigned without a leading dot.
 */
export function parseCookiesString(cookieStr: string, domain: string): CookieParam[] {
  if (!cookieStr.trim()) return []
  return cookieStr
    .split(';')
    .map((pair) => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) return null
      const name = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      if (!name) return null
      return { name, value, domain, path: '/' }
    })
    .filter((c): c is CookieParam => c !== null)
}

/**
 * Filters a list of raw links:
 * - Keeps only same-domain links
 * - Removes javascript:, #, mailto:, file extensions
 * - Removes logout links by text
 * - Deduplicates by href
 * - Limits to 200 results
 */
export function filterLinks(links: RawLink[], baseUrl: string): RawLink[] {
  const baseDomain = extractDomain(baseUrl)
  const seen = new Set<string>()

  return links
    .filter(({ text, href }) => {
      if (!href) return false
      // Skip anchor-only, javascript:, mailto:
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return false
      // Skip file extensions
      const lower = href.toLowerCase()
      if (FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false
      // Skip logout links by text
      const textLower = text.toLowerCase().trim()
      if (LOGOUT_KEYWORDS.some((kw) => textLower === kw)) return false
      // Skip external domains (only for absolute URLs)
      if (href.startsWith('http')) {
        if (extractDomain(href) !== baseDomain) return false
      }
      // Deduplicate
      if (seen.has(href)) return false
      seen.add(href)
      return true
    })
    .slice(0, 200)
}
```

- [ ] **Step 5: Rodar testes — esperar PASS**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx jest browse-helpers --no-coverage 2>&1 | tail -8
```

Expected: PASS — 15 tests

- [ ] **Step 6: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add lib/browse-helpers.ts __tests__/browse-helpers.test.ts package.json package-lock.json
git commit -m "feat: add browse-helpers pure functions with unit tests"
git push
```

---

## Task 2: `/api/browse` route

**Files:**
- Create: `app/api/browse/route.ts`

- [ ] **Step 1: Criar `app/api/browse/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import puppeteer, { Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import { parseCookiesString, filterLinks, extractDomain } from '@/lib/browse-helpers'

export const runtime = 'nodejs'

// Singleton browser — reutilizado entre invocações no mesmo container Vercel
let browserInstance: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance
  const executablePath = await chromium.executablePath(
    'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'
  )
  browserInstance = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: chromium.headless as boolean,
    defaultViewport: { width: 1280, height: 800 },
  })
  return browserInstance
}

export async function POST(req: NextRequest) {
  const { url, cookies } = await req.json() as { url: string; cookies: string }

  if (!url) {
    return NextResponse.json({ error: 'URL é obrigatória.' }, { status: 400 })
  }

  let validUrl: string
  try {
    validUrl = new URL(url).href
  } catch {
    return NextResponse.json({ error: 'URL inválida.' }, { status: 400 })
  }

  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    // Injetar cookies de sessão
    if (cookies?.trim()) {
      const domain = extractDomain(validUrl)
      const cookieParams = parseCookiesString(cookies, domain)
      if (cookieParams.length > 0) {
        await page.setCookie(...cookieParams)
      }
    }

    // Interceptar respostas .m3u8 de forma passiva (sem setRequestInterception)
    let streamUrl: string | null = null
    page.on('response', (response) => {
      const responseUrl = response.url()
      if (responseUrl.includes('.m3u8') && !streamUrl) {
        streamUrl = responseUrl
      }
    })

    // Navegar para a URL
    const response = await page.goto(validUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 22000,
    })

    const pageStatus = response?.status() ?? 0

    // Detectar sessão expirada: Puppeteer segue redirects automaticamente
    // Se a URL final contém "login" e a original não, os cookies foram rejeitados
    const finalUrl = page.url()
    const originalHasLogin = validUrl.toLowerCase().includes('login')
    const finalHasLogin = finalUrl.toLowerCase().includes('login')
    if (!originalHasLogin && finalHasLogin) {
      return NextResponse.json({
        error: 'Sessão expirada ou cookies inválidos — faça login novamente.',
      })
    }

    // Aguardar inicialização do player JS (HLS players disparam .m3u8 em ~1-2s)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Extrair título e links da página renderizada
    const { title, rawLinks } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'))
      return {
        title: document.title,
        rawLinks: anchors.map((a) => ({
          text: (a as HTMLAnchorElement).textContent?.trim() ?? '',
          href: (a as HTMLAnchorElement).href, // já é absoluta no contexto do browser
        })),
      }
    })

    const links = filterLinks(rawLinks, validUrl)

    return NextResponse.json({
      title,
      currentUrl: finalUrl,
      links,
      streamUrl,
      pageStatus,
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Tempo limite excedido. Tente novamente ou cole a URL do stream manualmente.' },
        { status: 504 }
      )
    }
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    // Fechar a página (não o browser) — evita leak no singleton
    await page.close()
  }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx tsc --noEmit 2>&1 | grep -v "ffmpeg-worker" | head -20
```

Corrigir erros antes de continuar.

- [ ] **Step 3: Verificar build**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npm run build 2>&1 | tail -15
```

Expected: `/api/browse` aparece como `ƒ (Dynamic)` na lista de rotas.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add app/api/browse/route.ts
git commit -m "feat: add /api/browse Node.js route with Puppeteer singleton"
git push
```

---

## Task 3: `BrowsePanel.tsx`

**Files:**
- Create: `components/BrowsePanel.tsx`

- [ ] **Step 1: Criar `components/BrowsePanel.tsx`**

```tsx
'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StatusMessage } from '@/components/StatusMessage'

interface BrowseLink {
  text: string
  href: string
}

interface BrowseResult {
  title: string
  currentUrl: string
  links: BrowseLink[]
  streamUrl: string | null
  pageStatus: number
}

interface HistoryEntry {
  title: string
  url: string
}

interface Props {
  cookies: string
  onStreamFound: (streamUrl: string) => void
  disabled?: boolean
}

export function BrowsePanel({ cookies, onStreamFound, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [inputUrl, setInputUrl] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [currentPage, setCurrentPage] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasNavigatedOnce = useRef(false)

  const isDisabled = disabled || loading

  async function navigate(url: string, resetHistory = false) {
    setLoading(true)
    setError(null)

    const isFirstNav = !hasNavigatedOnce.current

    const res = await fetch('/api/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookies }),
    })

    const data = await res.json() as BrowseResult & { error?: string }
    setLoading(false)
    hasNavigatedOnce.current = true

    if (data.error) {
      setError(data.error)
      return
    }

    if (resetHistory) {
      setHistory([])
    } else if (currentPage) {
      setHistory((h) => [...h, { title: currentPage.title, url: currentPage.currentUrl }])
    }

    setCurrentPage(data)
    setInputUrl(data.currentUrl)
  }

  function handleOpen() {
    if (!inputUrl) return
    navigate(inputUrl, true) // direct URL → reset history
  }

  function handleLinkClick(href: string) {
    navigate(href, false) // link click → push to history
  }

  function handleBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    navigate(prev.url, false)
  }

  function handleUseStream() {
    if (!currentPage?.streamUrl) return
    onStreamFound(currentPage.streamUrl)
    setOpen(false)
  }

  const showColdStartWarning = loading && !hasNavigatedOnce.current

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <span>Navegar no site</span>
          <span className="text-muted-foreground text-sm font-normal">
            {open ? '▲ Ocultar' : '▼ Expandir'}
          </span>
        </CardTitle>
        {!open && (
          <CardDescription>
            Navegue pelo site autenticado e capture o stream automaticamente
          </CardDescription>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <CardDescription>
            Use os cookies preenchidos acima. Navegue até a página da aula — o stream será capturado automaticamente.
          </CardDescription>

          {/* URL bar */}
          <div className="flex gap-2">
            <Input
              placeholder="https://ead.envisionar.com"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
              disabled={isDisabled}
              className="font-mono text-xs flex-1"
            />
            <Button
              onClick={handleOpen}
              disabled={isDisabled || !inputUrl}
              size="sm"
            >
              Abrir
            </Button>
          </div>

          {/* Cold start warning */}
          {showColdStartWarning && (
            <p className="text-sm text-muted-foreground">
              Iniciando o navegador... isso pode levar até 15 segundos na primeira vez (cold start).
            </p>
          )}

          {/* Loading state (after first nav) */}
          {loading && hasNavigatedOnce.current && (
            <p className="text-sm text-muted-foreground">Carregando página...</p>
          )}

          {/* Error */}
          {error && <StatusMessage status="error" message={error} />}

          {/* Navigation */}
          {currentPage && !loading && (
            <div className="space-y-3">
              {/* Back + breadcrumb */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                {history.length > 0 && (
                  <button
                    onClick={handleBack}
                    disabled={isDisabled}
                    className="flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    ← Voltar
                  </button>
                )}
                {history.length > 0 && <span>|</span>}
                {history.map((entry, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setHistory((h) => h.slice(0, i))
                        navigate(entry.url, false)
                      }}
                      disabled={isDisabled}
                      className="hover:text-foreground transition-colors disabled:opacity-50 truncate max-w-[120px]"
                      title={entry.title}
                    >
                      {entry.title || entry.url}
                    </button>
                    <span>›</span>
                  </span>
                ))}
                <span className="text-foreground truncate max-w-[160px]" title={currentPage.title}>
                  {currentPage.title || currentPage.currentUrl}
                </span>
              </div>

              {/* Stream found banner */}
              {currentPage.streamUrl && (
                <div className="flex items-center justify-between rounded-md bg-green-50 border border-green-200 px-4 py-3">
                  <span className="text-green-800 text-sm font-medium">✓ Stream encontrado!</span>
                  <Button
                    size="sm"
                    onClick={handleUseStream}
                    disabled={disabled}
                    className="bg-green-700 hover:bg-green-800 text-white"
                  >
                    Usar este stream
                  </Button>
                </div>
              )}

              {/* Link list */}
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {currentPage.links.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum link encontrado nesta página.</p>
                )}
                {currentPage.links.map((link, i) => (
                  <button
                    key={i}
                    onClick={() => handleLinkClick(link.href)}
                    disabled={isDisabled}
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors disabled:opacity-50 truncate"
                    title={link.href}
                  >
                    {link.text || link.href}
                  </button>
                ))}
                {currentPage.links.length === 200 && (
                  <p className="text-xs text-muted-foreground px-2">Mostrando primeiros 200 links</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx tsc --noEmit 2>&1 | grep -v "ffmpeg-worker" | head -20
```

- [ ] **Step 3: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add components/BrowsePanel.tsx
git commit -m "feat: add BrowsePanel navigation component"
git push
```

---

## Task 4: Wire `BrowsePanel` into `DownloadForm`

**Files:**
- Modify: `components/DownloadForm.tsx`

- [ ] **Step 1: Adicionar import e handler em `DownloadForm.tsx`**

Após a linha `import { LoginPanel } from '@/components/LoginPanel'`, adicionar:

```tsx
import { BrowsePanel } from '@/components/BrowsePanel'
```

Após `handleLoginSuccess`, adicionar:

```tsx
const handleStreamFound = (url: string) => {
  setStreamUrl(url)
  setDetectedStream(url)
  setStreamType('hls')
  setStatusMsg('Stream capturado automaticamente pelo navegador.')
}
```

- [ ] **Step 2: Adicionar `<BrowsePanel>` no JSX**

No `return`, entre o card de cookies e o card de extração:

```tsx
<BrowsePanel
  cookies={cookies}
  onStreamFound={handleStreamFound}
  disabled={isLoading}
/>
```

O layout final fica:
1. `<LoginPanel ...>`
2. Card de Cookies
3. `<BrowsePanel ...>`   ← novo
4. Card "Extrair stream da página"
5. Card "Download do vídeo"

- [ ] **Step 3: Rodar todos os testes**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npm test -- --passWithNoTests 2>&1 | tail -8
```

Expected: todos os testes passam (30+ testes incluindo browse-helpers).

- [ ] **Step 4: Build de produção**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npm run build 2>&1 | tail -12
```

Expected: build limpo com `/api/browse` como `ƒ (Dynamic)`.

- [ ] **Step 5: Commit e push**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add components/DownloadForm.tsx
git commit -m "feat: integrate BrowsePanel into DownloadForm"
git push
```

---

## Protocolo de teste manual (após deploy)

1. Abrir o app no Vercel
2. Colar cookies do `ead.envisionar.com` no campo "Cookies de sessão"
3. Expandir "Navegar no site"
4. Digitar `https://ead.envisionar.com` e clicar "Abrir"
5. Aguardar cold start (~10-15s na primeira vez)
6. Navegar pelos links até chegar na página de uma aula com vídeo
7. Verificar que o banner verde "Stream encontrado!" aparece
8. Clicar "Usar este stream"
9. Clicar "Baixar como MP4" — download deve iniciar

---
name: BaixarHSL — Navegação Autenticada com Puppeteer
description: Adiciona painel de navegação headless para sites autenticados e captura automática de stream .m3u8
type: project
---

# Navegação Autenticada + Captura Automática de Stream — Design Spec

## Objetivo

Adicionar ao BaixarHSL um painel de navegação que permite ao usuário navegar dentro de sites autenticados (usando cookies de sessão) e capturar automaticamente a URL do stream `.m3u8` quando chegar na página da aula, sem precisar inspecionar o Network tab manualmente.

## Problema resolvido

Sites como `ead.envisionar.com` (WordPress/LearnDash) carregam o player de vídeo via JavaScript assíncrono. O Cheerio (scraping estático) não consegue capturar a URL do stream. O Puppeteer renderiza a página com JavaScript completo e intercepta as respostas de rede, capturando o `.m3u8` automaticamente.

## Fluxo de uso

1. Usuário faz login (automático ou cookies manuais)
2. Expande o painel "Navegar no site"
3. Informa a URL inicial (ex: `https://ead.envisionar.com`)
4. Navega pelos links: plataforma → curso → módulo → aula
5. Ao chegar na página com vídeo: banner "Stream encontrado!" aparece automaticamente
6. Clica "Usar este stream" → campo de download preenchido automaticamente
7. Clica "Baixar como MP4"

## Arquitetura

```
Browser (usuário)
  │
  └── BrowsePanel.tsx (novo componente colapsável)
        │
        └── POST /api/browse (nova rota Node.js)
              ├── Puppeteer + @sparticuz/chromium-min (singleton por container)
              ├── Injeta cookies no contexto do browser
              ├── Navega para a URL (waitUntil: 'domcontentloaded' + 2s delay)
              ├── Intercepta respostas *.m3u8 via page.on('response') (passivo)
              ├── Extrai título + links do mesmo domínio
              └── Retorna { title, currentUrl, links, streamUrl, pageStatus }
```

## Componentes

### 1. API: `/api/browse` (Node.js serverless function)

**Runtime:** `export const runtime = 'nodejs'`

**Input:** `POST { url, cookies }`

**Singleton de browser (cold-start mitigation):**

O browser é mantido como singleton no escopo do módulo para reuso entre invocações no mesmo container Vercel:

```ts
let browserInstance: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance
  const executablePath = await chromium.executablePath()
  browserInstance = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: chromium.headless,
  })
  return browserInstance
}
```

Primeira invocação: ~8-12s (download do binário + launch). Invocações subsequentes no mesmo container: ~0s overhead.

**Interceptação de stream (.m3u8):**

Usar `page.on('response', ...)` — interceptação **passiva**, não requer `setRequestInterception(true)` e não bloqueia nenhuma requisição:

```ts
let streamUrl: string | null = null
page.on('response', (response) => {
  const url = response.url()
  if (url.includes('.m3u8') && !streamUrl) {
    streamUrl = url
  }
})
```

**Lógica completa** (todo o bloco 2-9 dentro de `try/finally { page.close() }`):
1. `getBrowser()` — reusa ou lança singleton
2. Criar nova página: `const page = await browser.newPage()`
3. Parsear cookies e injetar via `page.setCookie(...cookies)` — domínio extraído da URL destino, sem ponto inicial (ex: `ead.envisionar.com`)
4. Registrar listener `page.on('response', ...)` antes de navegar
5. `const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 })`
6. Capturar status: `const pageStatus = response?.status() ?? 0`
7. Detectar sessão expirada: se `page.url()` contém "login" e a URL original não continha "login", retornar `{ error: "Sessão expirada ou cookies inválidos — faça login novamente." }`
8. Aguardar 2s (`await page.waitForTimeout(2000)`) para inicialização do player JS
9. Extrair `document.title` e links via `page.evaluate()`
10. Retornar resultado
11. `finally { await page.close() }` — garante fechamento mesmo em caso de erro, evitando leak de páginas no singleton

**Por que `domcontentloaded` + 2s em vez de `networkidle2`:**
Páginas de LMS com player HLS mantêm conexões persistentes ao CDN de segmentos, nunca atingindo `networkidle2`. O player dispara a requisição `.m3u8` nos primeiros 1-2s após `domcontentloaded`, dentro da janela de espera.

**Tratamento de cookies:**
- Parsear `nome=valor; outro=valor2` → array de objetos `{name, value, domain, path}`
- `domain`: hostname extraído da URL de destino **sem ponto inicial** (ex: `ead.envisionar.com`)
- Detecção de sessão expirada: verificar `page.url()` após `goto` — se a URL final contém "login" e a URL original não continha, os cookies foram rejeitados (Puppeteer segue redirects automaticamente, então `pageStatus` nunca será 3xx)

**Filtragem de links:**
- Apenas mesmo domínio (sem links externos)
- Excluir: `#`, `javascript:`, `mailto:`, extensões de arquivo (`.pdf`, `.zip`, `.jpg`, etc.)
- Excluir por texto (case-insensitive, português): "Sair", "Logout", "Sign out", "Desconectar"
- Deduplicar por href
- Limitar a 200 links (UI nota "mostrando primeiros 200")

**Output:**
```ts
// Sucesso
{ title: string, currentUrl: string, links: {text: string, href: string}[], streamUrl: string | null, pageStatus: number }

// Erro
{ error: string }
```

- Timeout (>22s): `{ error: "Tempo limite excedido. Tente novamente ou cole a URL do stream manualmente." }`
- Cookies inválidos (redirect para login): `{ error: "Sessão expirada ou cookies inválidos — faça login novamente." }`
- Erro genérico: `{ error: "mensagem" }`

**Limitações documentadas:**
- Cold start de 10-15s na primeira requisição por container (Vercel recicla containers periodicamente)
- Não funciona com reCAPTCHA visual ou 2FA interativo
- Timeout total de 22s (margem de 8s para o limite de 30s do Vercel Hobby)

### 2. Componente: `BrowsePanel.tsx`

**Props:**
```ts
interface Props {
  cookies: string
  onStreamFound: (streamUrl: string) => void
  disabled?: boolean  // desabilita TODO o painel (navegação + botões) quando DownloadForm está carregando
}
```

**Estado interno:**
```ts
const [open, setOpen] = useState(false)
const [inputUrl, setInputUrl] = useState('')
const [history, setHistory] = useState<{ title: string; url: string }[]>([])
const [currentPage, setCurrentPage] = useState<BrowseResult | null>(null)
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
const hasNavigatedOnce = useRef(false)  // controla aviso de cold start
```

**Comportamento de navegação:**

- **Clicar num link da lista**: push da página atual no `history`, navega para o link
- **Voltar**: pop do `history` stack, navega para a URL do item removido
- **Navegação direta pelo campo de URL**: **reseta o history stack** (nova sessão de navegação), navega para a URL informada
- `disabled` prop desabilita: campo de URL, botão "Abrir", todos os links da lista, botão "Voltar", botão "Usar este stream"

**Cold start warning:**

Na primeira navegação da sessão (`!hasNavigatedOnce.current`), exibir mensagem: "Iniciando o navegador... isso pode levar até 15 segundos na primeira vez (cold start)."

Após a primeira resposta, `hasNavigatedOnce.current = true` e o aviso não aparece mais.

**Layout (quando expandido):**
```
┌─ Navegar no site ──────────────────────── ▲ Ocultar ─┐
│ [https://ead.envisionar.com          ] [Abrir]        │
│                                                        │
│ ← Voltar  |  Home > Curso X > Módulo Y                │
│                                                        │
│ Página: Módulo Y — Introdução                          │
│                                                        │
│ • Aula 1 - Fundamentos                                 │
│ • Aula 2 - Prática                                     │
│ • Aula 3 - Revisão                                     │
│ ...                                                    │
│                                                        │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ✓ Stream encontrado! [Usar este stream]         │   │
│ └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**"Usar este stream":** chama `onStreamFound(streamUrl)` e fecha o painel (`setOpen(false)`).

### 3. Modificação: `DownloadForm.tsx`

Adicionar `<BrowsePanel>` entre o card de cookies e o card de extração:

```tsx
import { BrowsePanel } from '@/components/BrowsePanel'

// handler:
const handleStreamFound = (url: string) => {
  setStreamUrl(url)
  setDetectedStream(url)
  setStreamType('hls')
  setStatusMsg('Stream capturado automaticamente pelo navegador.')
}

// JSX (após o card de cookies, antes do card de extração):
<BrowsePanel
  cookies={cookies}
  onStreamFound={handleStreamFound}
  disabled={isLoading}
/>
```

## Helpers testáveis: `lib/browse-helpers.ts`

Funções puras extraídas para facilitar testes unitários:

```ts
export function parseCookiesString(cookieStr: string, domain: string): CookieParam[]
// "a=1; b=2" + "ead.envisionar.com" → [{name:'a', value:'1', domain:'ead.envisionar.com', path:'/'}, ...]

export function filterLinks(links: RawLink[], baseUrl: string): {text: string, href: string}[]
// Remove externos, duplicados, inválidos, logout links. Limita a 200.

export function extractDomain(url: string): string
// "https://ead.envisionar.com/courses" → "ead.envisionar.com" (sem ponto inicial)
// "http://localhost:3000" → "localhost" (edge case: sem ponto)
```

## Testes: `__tests__/browse-helpers.test.ts`

```ts
describe('parseCookiesString', () => {
  it('parses multiple cookies into array', ...)
  it('assigns correct domain without leading dot', ...)
  it('returns empty array for empty string', ...)
})

describe('filterLinks', () => {
  it('removes external domain links', ...)
  it('removes javascript: and # hrefs', ...)
  it('removes file extension links (.pdf, .zip)', ...)
  it('removes logout links by text (Sair, Logout, Sign out, Desconectar)', ...)
  it('deduplicates by href', ...)
  it('limits to 200 links', ...)
})

describe('extractDomain', () => {
  it('extracts hostname without leading dot', ...)
  it('handles localhost correctly (no leading dot)', ...)
  it('handles subdomains correctly', ...)
})
```

## Dependências novas

```json
"puppeteer-core": "^21.x",
"@sparticuz/chromium-min": "^123.x"
```

**Nota sobre tamanho:** `@sparticuz/chromium-min` baixa o binário do Chromium em runtime via URL pública (não inclui o binário no ZIP da função). O ZIP da função fica ~5MB. O binário (~45MB) é baixado no cold start, adicionando ~3s à primeira inicialização. Total cold start estimado: 10-15s.

## Stack

Mesmo stack existente + `puppeteer-core` + `@sparticuz/chromium-min`.

## Não está no escopo

- Renderização visual do HTML da página (full browser proxy)
- Suporte a reCAPTCHA visual ou 2FA interativo
- Histórico persistido entre sessões do browser do usuário
- Download múltiplo de aulas em sequência
- Sites em idiomas além do português (logout keyword list é PT-BR)

# Login Automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic form-based login to BaixarHSL so users can authenticate on restricted sites by entering username/password instead of manually copying cookies.

**Architecture:** A new `lib/form-login.ts` encapsulates pure form-detection and cookie-parsing logic (testable in Jest). A new `/api/login` Node.js serverless route uses Cheerio to detect the login form, submits credentials with `redirect: 'manual'` to capture Set-Cookie from each redirect hop, and detects success by comparing the final URL against the original login URL. A new `LoginPanel` component sits above the cookies textarea and calls `onLoginSuccess(cookies)` to auto-fill it on success.

**Tech Stack:** Next.js 16 (App Router), Cheerio (Node.js runtime), Tailwind CSS, shadcn/ui (existing project)

---

## File Structure

```
BaixarHSL/
├── lib/
│   └── form-login.ts          # NEW — pure functions: findLoginForm, buildFormBody, parseSetCookieHeaders
├── app/api/login/
│   └── route.ts               # NEW — POST /api/login, runtime='nodejs'
├── components/
│   └── LoginPanel.tsx         # NEW — collapsible login form UI
└── components/
    └── DownloadForm.tsx       # MODIFY — add <LoginPanel onLoginSuccess={...} />
```

```
__tests__/
└── form-login.test.ts         # NEW — unit tests for lib/form-login.ts pure functions
```

---

## Task 1: Pure form-login functions (`lib/form-login.ts`)

**Files:**
- Create: `lib/form-login.ts`
- Create: `__tests__/form-login.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/form-login.test.ts`:
```ts
import {
  findLoginForm,
  buildFormBody,
  parseSetCookieHeaders,
  resolveFormAction,
} from '@/lib/form-login'

// ── findLoginForm ──────────────────────────────────────────────────────────────

describe('findLoginForm', () => {
  it('returns null when no form with password field exists', () => {
    const html = '<html><body><form><input type="text" /></form></body></html>'
    expect(findLoginForm(html)).toBeNull()
  })

  it('detects a standard email+password form', () => {
    const html = `
      <form action="/login" method="post">
        <input type="email" name="email" />
        <input type="password" name="password" />
        <input type="hidden" name="_token" value="csrf123" />
      </form>
    `
    const result = findLoginForm(html)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('/login')
    expect(result!.usernameField).toBe('email')
    expect(result!.passwordField).toBe('password')
    expect(result!.hiddenFields).toEqual({ _token: 'csrf123' })
  })

  it('falls back to name-based detection for username field', () => {
    const html = `
      <form action="/auth">
        <input type="text" name="usuario" />
        <input type="password" name="senha" />
      </form>
    `
    const result = findLoginForm(html)
    expect(result).not.toBeNull()
    expect(result!.usernameField).toBe('usuario')
  })

  it('returns null when password field has no name attribute', () => {
    const html = `
      <form action="/login">
        <input type="password" />
      </form>
    `
    expect(findLoginForm(html)).toBeNull()
  })
})

// ── buildFormBody ──────────────────────────────────────────────────────────────

describe('buildFormBody', () => {
  it('builds URLSearchParams string with all fields', () => {
    const body = buildFormBody({
      usernameField: 'email',
      passwordField: 'password',
      username: 'user@test.com',
      password: 'secret',
      hiddenFields: { _token: 'csrf123' },
    })
    const params = new URLSearchParams(body)
    expect(params.get('email')).toBe('user@test.com')
    expect(params.get('password')).toBe('secret')
    expect(params.get('_token')).toBe('csrf123')
  })

  it('works with no hidden fields', () => {
    const body = buildFormBody({
      usernameField: 'login',
      passwordField: 'pass',
      username: 'admin',
      password: '1234',
      hiddenFields: {},
    })
    const params = new URLSearchParams(body)
    expect(params.get('login')).toBe('admin')
    expect(params.get('pass')).toBe('1234')
  })
})

// ── parseSetCookieHeaders ──────────────────────────────────────────────────────

describe('parseSetCookieHeaders', () => {
  it('extracts name=value pairs from Set-Cookie headers', () => {
    const headers = [
      'session=abc123; Path=/; HttpOnly',
      'token=xyz; Path=/; Secure',
    ]
    expect(parseSetCookieHeaders(headers)).toBe('session=abc123; token=xyz')
  })

  it('returns empty string for empty array', () => {
    expect(parseSetCookieHeaders([])).toBe('')
  })

  it('handles single cookie', () => {
    expect(parseSetCookieHeaders(['user_id=42; Path=/'])).toBe('user_id=42')
  })
})

// ── resolveFormAction ──────────────────────────────────────────────────────────

describe('resolveFormAction', () => {
  it('resolves relative action against base URL', () => {
    expect(resolveFormAction('/auth/login', 'https://example.com/signin'))
      .toBe('https://example.com/auth/login')
  })

  it('returns absolute action URL unchanged', () => {
    expect(resolveFormAction('https://example.com/auth', 'https://example.com/signin'))
      .toBe('https://example.com/auth')
  })

  it('handles action-less forms by returning the base URL', () => {
    expect(resolveFormAction('', 'https://example.com/login'))
      .toBe('https://example.com/login')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx jest form-login --no-coverage 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/form-login'"

- [ ] **Step 3: Implement `lib/form-login.ts`**

```ts
import * as cheerio from 'cheerio'

export interface LoginForm {
  action: string          // resolved absolute URL
  usernameField: string   // name attribute of the username input
  passwordField: string   // name attribute of the password input
  hiddenFields: Record<string, string>
}

/**
 * Scans HTML for a login form (one that contains input[type=password]).
 * Returns null if no suitable form is found.
 */
export function findLoginForm(html: string): LoginForm | null {
  const $ = cheerio.load(html)

  let targetForm: ReturnType<typeof $> | null = null

  $('form').each((_, el) => {
    if ($(el).find('input[type=password]').length > 0) {
      targetForm = $(el) as unknown as ReturnType<typeof $>
      return false // break
    }
  })

  if (!targetForm) return null

  const form = targetForm as ReturnType<typeof $>

  // Password field
  const passwordInput = form.find('input[type=password]').first()
  const passwordField = passwordInput.attr('name')
  if (!passwordField) return null

  // Username field — priority: type=email > type=text > name heuristic (email/user/login/cpf)
  const NAME_HINTS = ['email', 'user', 'login', 'cpf', 'username', 'usuario']

  let usernameField: string | null = null

  const emailInput = form.find('input[type=email]').first()
  if (emailInput.attr('name')) {
    usernameField = emailInput.attr('name')!
  } else {
    const textInput = form.find('input[type=text]').first()
    if (textInput.attr('name')) {
      usernameField = textInput.attr('name')!
    } else {
      // Fallback: scan all text-like inputs for name containing a known hint
      form.find('input:not([type=password]):not([type=hidden]):not([type=submit]):not([type=checkbox])').each((_, el) => {
        const name = $(el).attr('name') ?? ''
        if (NAME_HINTS.some((hint) => name.toLowerCase().includes(hint))) {
          usernameField = name
          return false // break
        }
      })
    }
  }

  if (!usernameField) return null

  // Hidden fields (CSRF tokens, etc.)
  const hiddenFields: Record<string, string> = {}
  form.find('input[type=hidden]').each((_, el) => {
    const name = $(el).attr('name')
    const value = $(el).attr('value') ?? ''
    if (name) hiddenFields[name] = value
  })

  const rawAction = form.attr('action') ?? ''

  return { action: rawAction, usernameField, passwordField, hiddenFields }
}

/**
 * Builds a URLSearchParams-encoded form body string.
 */
export function buildFormBody(opts: {
  usernameField: string
  passwordField: string
  username: string
  password: string
  hiddenFields: Record<string, string>
}): string {
  const params = new URLSearchParams()
  // Hidden fields first (CSRF must precede credentials on some sites)
  for (const [k, v] of Object.entries(opts.hiddenFields)) {
    params.append(k, v)
  }
  params.append(opts.usernameField, opts.username)
  params.append(opts.passwordField, opts.password)
  return params.toString()
}

/**
 * Extracts name=value pairs from an array of Set-Cookie header strings.
 * Discards attributes (Path, HttpOnly, Secure, Expires, etc.).
 */
export function parseSetCookieHeaders(headers: string[]): string {
  return headers
    .map((h) => h.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

/**
 * Resolves a form action (possibly relative) against the page URL.
 */
export function resolveFormAction(action: string, pageUrl: string): string {
  if (!action) return pageUrl
  try {
    return new URL(action, pageUrl).href
  } catch {
    return pageUrl
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx jest form-login --no-coverage 2>&1 | tail -10
```

Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add lib/form-login.ts __tests__/form-login.test.ts
git commit -m "feat: add form-login pure functions with unit tests"
git push
```

---

## Task 2: `/api/login` route

**Files:**
- Create: `app/api/login/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/login/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import {
  findLoginForm,
  buildFormBody,
  parseSetCookieHeaders,
  resolveFormAction,
} from '@/lib/form-login'

// Node.js runtime required — Cheerio uses Node built-ins
export const runtime = 'nodejs'

const MAX_REDIRECTS = 5
const TIMEOUT_MS = 25_000

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
}

/**
 * Manually follows redirects, collecting Set-Cookie headers at each hop.
 * Returns { finalUrl, allCookies }.
 */
async function fetchFollowingRedirects(
  url: string,
  init: RequestInit,
  accumulatedCookies: string[] = [],
  hops = 0
): Promise<{ finalUrl: string; allCookies: string[] }> {
  if (hops >= MAX_REDIRECTS) {
    return { finalUrl: url, allCookies: accumulatedCookies }
  }

  const res = await fetch(url, { ...init, redirect: 'manual' })

  // Collect Set-Cookie from this response
  const setCookie = res.headers.getSetCookie?.() ?? []
  const newCookies = [...accumulatedCookies, ...setCookie]

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    if (!location) return { finalUrl: url, allCookies: newCookies }
    const nextUrl = new URL(location, url).href
    // Build accumulated cookie string for the next request
    const cookieHeader = parseSetCookieHeaders(newCookies)
    return fetchFollowingRedirects(
      nextUrl,
      { ...init, method: 'GET', body: undefined, headers: { ...BROWSER_HEADERS, Cookie: cookieHeader } },
      newCookies,
      hops + 1
    )
  }

  return { finalUrl: url, allCookies: newCookies }
}

export async function POST(req: NextRequest) {
  const { loginUrl, username, password } = await req.json() as {
    loginUrl: string
    username: string
    password: string
  }

  if (!loginUrl || !username || !password) {
    return NextResponse.json(
      { success: false, cookies: '', message: 'loginUrl, username e password são obrigatórios.' },
      { status: 400 }
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // 1. Fetch login page
    const pageRes = await fetch(loginUrl, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    })
    if (!pageRes.ok) {
      return NextResponse.json(
        { success: false, cookies: '', message: `Página de login retornou HTTP ${pageRes.status}` },
        { status: 502 }
      )
    }

    const html = await pageRes.text()

    // 2. Detect login form
    const form = findLoginForm(html)
    if (!form) {
      return NextResponse.json(
        {
          success: false,
          cookies: '',
          message:
            'Formulário de login não encontrado. O site pode usar login via JavaScript — use cookies manuais.',
        },
        { status: 422 }
      )
    }

    // 3. Resolve action URL
    const actionUrl = resolveFormAction(form.action, loginUrl)

    // 4. Build POST body
    const body = buildFormBody({
      usernameField: form.usernameField,
      passwordField: form.passwordField,
      username,
      password,
      hiddenFields: form.hiddenFields,
    })

    // 5. Submit credentials, manually following redirects to capture all Set-Cookie headers
    const { finalUrl, allCookies } = await fetchFollowingRedirects(actionUrl, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginUrl,
      },
      body,
      signal: controller.signal,
    })

    // 6. Detect success: final URL must differ from login URL
    const loginOriginPath = new URL(loginUrl).pathname
    const finalPath = new URL(finalUrl).pathname
    const loggedIn = finalPath !== loginOriginPath

    if (!loggedIn) {
      return NextResponse.json({
        success: false,
        cookies: '',
        message: 'Login rejeitado — verifique suas credenciais. O site pode usar reCAPTCHA ou 2FA.',
      })
    }

    const cookies = parseSetCookieHeaders(allCookies)
    return NextResponse.json({
      success: true,
      cookies,
      message: 'Login realizado com sucesso!',
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, cookies: '', message: 'Tempo limite de 25s excedido.' },
        { status: 504 }
      )
    }
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ success: false, cookies: '', message }, { status: 500 })
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx tsc --noEmit 2>&1 | grep -v "ffmpeg-worker" | head -20
```

Fix any errors before committing.

- [ ] **Step 3: Verify build**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npm run build 2>&1 | tail -15
```

Expected: clean build with `/api/login` appearing in the route list.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add app/api/login/route.ts
git commit -m "feat: add /api/login Node.js route for form-based authentication"
git push
```

---

## Task 3: `LoginPanel` component

**Files:**
- Create: `components/LoginPanel.tsx`

- [ ] **Step 1: Create `components/LoginPanel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusMessage } from '@/components/StatusMessage'

interface Props {
  onLoginSuccess: (cookies: string) => void
  disabled?: boolean
}

export function LoginPanel({ onLoginSuccess, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [loginUrl, setLoginUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null)

  const handleLogin = async () => {
    if (!loginUrl || !username || !password) return
    setLoading(true)
    setStatus(null)

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginUrl, username, password }),
    })

    const data = await res.json() as { success: boolean; cookies: string; message: string }
    setLoading(false)

    if (data.success) {
      setStatus({ type: 'success', message: data.message })
      onLoginSuccess(data.cookies)
      // Clear sensitive fields after success
      setUsername('')
      setPassword('')
    } else {
      setStatus({ type: 'error', message: data.message })
    }
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <span>Fazer Login Automático</span>
          <span className="text-muted-foreground text-sm font-normal">
            {open ? '▲ Ocultar' : '▼ Expandir'}
          </span>
        </CardTitle>
        {!open && (
          <CardDescription>
            Entre com usuário e senha para sites com formulário de login padrão
          </CardDescription>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <CardDescription>
            Funciona em sites com formulário HTML padrão. Não funciona com reCAPTCHA, 2FA ou login via JavaScript.
          </CardDescription>

          <div className="space-y-1">
            <Label htmlFor="login-url">URL da página de login</Label>
            <Input
              id="login-url"
              placeholder="https://plataforma.com/login"
              value={loginUrl}
              onChange={(e) => setLoginUrl(e.target.value)}
              disabled={loading || disabled}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="login-username">Usuário / E-mail</Label>
            <Input
              id="login-username"
              placeholder="seu@email.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading || disabled}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="login-password">Senha</Label>
            <Input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || disabled}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading || disabled || !loginUrl || !username || !password}
            className="w-full"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>

          {status && <StatusMessage status={status.type} message={status.message} />}
        </CardContent>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add components/LoginPanel.tsx
git commit -m "feat: add LoginPanel collapsible component"
git push
```

---

## Task 4: Wire `LoginPanel` into `DownloadForm`

**Files:**
- Modify: `components/DownloadForm.tsx`

- [ ] **Step 1: Read current DownloadForm**

Read `c:/Users/filip/DEV/BaixarHSL/components/DownloadForm.tsx` to identify the exact insertion point.

- [ ] **Step 2: Add import and handleLoginSuccess**

Add this import at the top of `DownloadForm.tsx` (after existing imports):
```tsx
import { LoginPanel } from '@/components/LoginPanel'
```

Add `handleLoginSuccess` inside the component (after `handleProgress`):
```tsx
const handleLoginSuccess = (newCookies: string) => {
  setCookies(newCookies)
  setStatusMsg('Cookies preenchidos automaticamente após login.')
}
```

- [ ] **Step 3: Add LoginPanel to JSX**

In the `return` block, add `<LoginPanel>` as the first card, before the existing "Extrair stream da página" card:
```tsx
<LoginPanel onLoginSuccess={handleLoginSuccess} disabled={isLoading} />
```

- [ ] **Step 4: Verify TypeScript and build**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx tsc --noEmit 2>&1 | grep -v "ffmpeg-worker" | head -20
npm run build 2>&1 | tail -15
```

Fix any errors.

- [ ] **Step 5: Run all tests**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (now 20+ tests including form-login suite).

- [ ] **Step 6: Commit and push**

```bash
cd c:/Users/filip/DEV/BaixarHSL
git add components/DownloadForm.tsx
git commit -m "feat: integrate LoginPanel into DownloadForm"
git push
```

---

## Task 5: Deploy updated app to Vercel

- [ ] **Step 1: Confirm build is clean**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npm run build 2>&1 | tail -10
```

- [ ] **Step 2: Deploy**

```bash
cd c:/Users/filip/DEV/BaixarHSL && npx vercel --prod
```

Expected: deployment URL printed. `/api/login` should appear as a serverless function (Node.js), not Edge.

- [ ] **Step 3: Smoke test the login endpoint**

```bash
curl -X POST https://<your-vercel-url>/api/login \
  -H "Content-Type: application/json" \
  -d '{"loginUrl":"https://httpbin.org/forms/post","username":"test","password":"test"}' | head -c 200
```

Expected: JSON response with `success: false` and a message (httpbin form doesn't redirect on submit, so it correctly reports "Login rejeitado").

---

## End-to-End Test Protocol

1. Open the deployed app
2. Click "Fazer Login Automático ▼ Expandir"
3. Enter a real site's login URL + your credentials
4. Click "Entrar"
5. Verify: cookies textarea is auto-filled, success message appears
6. Paste the video page URL → click "Extrair URL do stream"
7. Click "Baixar como MP4" → verify download completes

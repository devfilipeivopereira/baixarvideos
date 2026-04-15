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

  const setCookie = res.headers.getSetCookie?.() ?? []
  const newCookies = [...accumulatedCookies, ...setCookie]

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    if (!location) return { finalUrl: url, allCookies: newCookies }
    const nextUrl = new URL(location, url).href
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

    const actionUrl = resolveFormAction(form.action, loginUrl)
    const body = buildFormBody({
      usernameField: form.usernameField,
      passwordField: form.passwordField,
      username,
      password,
      hiddenFields: form.hiddenFields,
    })

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

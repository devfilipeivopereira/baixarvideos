import { NextRequest, NextResponse } from 'next/server'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { parseCookiesString, filterLinks, extractDomain } from '@/lib/browse-helpers'

export const runtime = 'nodejs'

// Singleton para dev local (Browserless gerencia o pool em produção)
let localBrowser: Browser | null = null

async function getBrowser(): Promise<{ browser: Browser; isRemote: boolean }> {
  const token = process.env.BROWSERLESS_TOKEN

  if (token) {
    // Produção (Vercel): conecta ao Browserless.io via WebSocket
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${token}&timeout=25000`,
    })
    return { browser, isRemote: true }
  }

  // Dev local: singleton com @sparticuz/chromium
  if (localBrowser && localBrowser.isConnected()) {
    return { browser: localBrowser, isRemote: false }
  }
  localBrowser = null
  const chromium = await import('@sparticuz/chromium')
  const executablePath = await chromium.default.executablePath()
  localBrowser = await puppeteer.launch({
    args: [...chromium.default.args, '--no-sandbox', '--disable-setuid-sandbox'],
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  })
  return { browser: localBrowser, isRemote: false }
}

export async function POST(req: NextRequest) {
  let page: Page | null = null
  let browser: Browser | null = null
  let isRemote = false

  try {
    const { url, cookies } = (await req.json()) as { url: string; cookies: string }

    if (!url) {
      return NextResponse.json({ error: 'URL é obrigatória.' }, { status: 400 })
    }

    let validUrl: string
    try {
      validUrl = new URL(url).href
    } catch {
      return NextResponse.json({ error: 'URL inválida.' }, { status: 400 })
    }

    const result = await getBrowser()
    browser = result.browser
    isRemote = result.isRemote
    page = await browser.newPage()

    // Injetar cookies de sessão
    if (cookies?.trim()) {
      const domain = extractDomain(validUrl)
      const cookieParams = parseCookiesString(cookies, domain)
      if (cookieParams.length > 0) {
        await page.setCookie(...cookieParams)
      }
    }

    // Interceptar respostas .m3u8 de forma passiva
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

    // Detectar sessão expirada
    const finalUrl = page.url()
    const originalHasLogin = validUrl.toLowerCase().includes('login')
    const finalHasLogin = finalUrl.toLowerCase().includes('login')
    if (!originalHasLogin && finalHasLogin) {
      return NextResponse.json({
        error: 'Sessão expirada ou cookies inválidos — faça login novamente.',
      })
    }

    // Aguardar inicialização do player JS
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Extrair título e links da página renderizada
    const { title, rawLinks } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'))
      return {
        title: document.title,
        rawLinks: anchors.map((a) => ({
          text: (a as HTMLAnchorElement).textContent?.trim() ?? '',
          href: (a as HTMLAnchorElement).href,
        })),
      }
    })

    const links = filterLinks(rawLinks, validUrl)

    return NextResponse.json({ title, currentUrl: finalUrl, links, streamUrl, pageStatus })
  } catch (err: unknown) {
    // Invalidar singleton local se crashou
    localBrowser = null

    if (err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('timeout'))) {
      return NextResponse.json(
        { error: 'Tempo limite excedido. Tente novamente ou cole a URL do stream manualmente.' },
        { status: 504 }
      )
    }
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    if (page) await page.close().catch(() => {})
    // Em produção, desconectar do Browserless após cada requisição
    if (isRemote && browser) await browser.close().catch(() => {})
  }
}

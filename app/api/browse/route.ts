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
    headless: true,
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

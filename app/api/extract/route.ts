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

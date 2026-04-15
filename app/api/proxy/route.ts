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

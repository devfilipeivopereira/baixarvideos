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
import { LoginPanel } from '@/components/LoginPanel'

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

  const handleLoginSuccess = (newCookies: string) => {
    setCookies(newCookies)
    setStatusMsg('Cookies preenchidos automaticamente após login.')
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LoginPanel onLoginSuccess={handleLoginSuccess} disabled={isLoading} />
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

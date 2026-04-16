'use client'

import { useState, useEffect } from 'react'
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
import { BrowsePanel } from '@/components/BrowsePanel'

type Phase = 'idle' | 'extracting' | 'downloading' | 'done' | 'error'

function SectionLabel({ step, label, hint }: { step: number; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
        {step}
      </span>
      <span className="font-medium text-sm">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">— {hint}</span>}
    </div>
  )
}

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

  // Pré-preencher stream URL vindo da extensão Chrome (?stream=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromExtension = params.get('stream')
    if (fromExtension) {
      setStreamUrl(fromExtension)
      setDetectedStream(fromExtension)
      setStreamType('hls')
      setStatusMsg('Stream recebido da extensão Chrome.')
      // Limpar da URL sem recarregar
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

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

  const handleStreamFound = (url: string) => {
    setStreamUrl(url)
    setDetectedStream(url)
    setStreamType('hls')
    setStatusMsg('Stream capturado automaticamente pelo navegador.')
  }

  return (
    <div className="space-y-4">
      <SectionLabel step={1} label="Login automático" hint="opcional" />
      <LoginPanel onLoginSuccess={handleLoginSuccess} disabled={isLoading} />

      <SectionLabel step={2} label="Cookies de sessão" hint="opcional se fez login acima" />
      <Card>
        <CardHeader>
          <CardTitle>Cookies de sessão</CardTitle>
          <CardDescription>
            Cole aqui os cookies copiados do DevTools. No browser: F12 → Application → Cookies → clique no domínio do site → copie os valores como <code>nome=valor; outro=valor2</code>. Ou use o console: <code>document.cookie</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="cookies"
            placeholder="session_id=abc123; auth_token=xyz; wordpress_logged_in_...=..."
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            rows={4}
            disabled={isLoading}
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      <SectionLabel step={3} label="Navegar no site" hint="opcional — captura stream automaticamente" />
      <BrowsePanel
        cookies={cookies}
        onStreamFound={handleStreamFound}
        disabled={isLoading}
      />

      <SectionLabel step={4} label="Extrair stream da página" hint="para sites com HTML estático" />
      <Card>
        <CardHeader>
          <CardTitle>Extrair stream da página</CardTitle>
          <CardDescription>
            Cole a URL da página do vídeo para encontrar automaticamente o link .m3u8.
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
          <Button onClick={handleExtract} disabled={isLoading || !pageUrl} className="w-full">
            {phase === 'extracting' ? 'Extraindo...' : 'Extrair URL do stream'}
          </Button>
        </CardContent>
      </Card>

      <SectionLabel step={5} label="Download do vídeo" />
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

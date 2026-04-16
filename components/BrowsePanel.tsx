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
    navigate(inputUrl, true)
  }

  function handleLinkClick(href: string) {
    navigate(href, false)
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

          {/* Loading after first nav */}
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

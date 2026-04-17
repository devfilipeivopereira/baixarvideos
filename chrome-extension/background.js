// Importar módulos de suporte (com proteção contra falhas)
try {
  importScripts('detector.js', 'diagnostics.js', 'stream-details.js', 'hls.js', 'vimeo-playlist.js')
} catch (e) {
  console.error('[BaixarHSL] Falha ao carregar módulos:', e && e.message)
}

var STREAMS_KEY = 'streams'
var DIAG_KEY = 'diagnosticsByTab'
var VIMEO_CFG_KEY_PREFIX = 'vc_'
var MAX_STREAMS = 50
var resolvedCache = new Map()

// ── Detecção de URL de mídia (resiliente, sem depender do detector) ──────────
function detectMediaType(url) {
  var lower = String(url || '').toLowerCase()
  if (!lower.startsWith('http')) return null

  // Fragmentos adaptativos e legendas — ignorar completamente
  if (
    lower.includes('/range/') ||
    lower.includes('/segment/') ||
    lower.includes('/avf/') ||
    lower.includes('.m4s') ||
    /[?&]range=/.test(lower) ||
    /[?&]ext-subs=/.test(lower)
  ) return null

  // Manifesto / protocolo vem primeiro — mais confiável que extensão
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'

  // Plataformas brasileiras: verificar antes da extensão .mp4 porque
  // essas URLs costumam ter .mp4 no caminho mas retornam HLS ou redirect HTML
  if (/pandavideo\.com\.br|pandacdn\.com/i.test(lower)) return 'hls'
  if (/player\.vimeo\.com\/video\/\d+\/config/i.test(lower)) return 'vimeo'
  if (lower.includes('vimeocdn.com') && (lower.includes('playlist.json') || lower.includes('master.json'))) return 'vimeo'
  if (/skyfire\.vimeocdn\.com|vod-adaptive-ak\.vimeocdn\.com/i.test(lower) && (lower.includes('playlist.json') || lower.includes('master.json'))) return 'vimeo'
  if (/hotmart|herospark|eduzz|kiwify|sparkle|estrategia|curseduca/i.test(lower) && lower.includes('manifest')) return 'hls'
  if (/brightcove\.net|bcovlive\.io/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8') || lower.includes('.mpd'))) return 'hls'
  if (/sambatech\.com\.br|sambavideos\.com\.br/i.test(lower)) return 'hls'
  if (/jwpcdn\.com|jwplatform\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return 'hls'

  // Usa detector se disponível (inclui mais padrões)
  if (self.BaixarHSLDetector && typeof self.BaixarHSLDetector.detectStreamFromRequest === 'function') {
    var match = self.BaixarHSLDetector.detectStreamFromRequest(url)
    if (match) return match.type
  }

  // Extensão de arquivo de vídeo direto — só depois de descartar plataformas
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(lower)) return 'progressive'

  return null
}

// ── Normalização de URL para deduplicação ────────────────────────────────────
function dedupeKeyForUrl(url, type) {
  if (type !== 'vimeo') return url

  // Para URLs de config do Vimeo, ignorar params de rastreio (dnt, app_id)
  // mantendo apenas o param 'h' (token de vídeo privado)
  try {
    var parsed = new URL(url)
    if (/player\.vimeo\.com\/video\/\d+\/config/i.test(parsed.pathname)) {
      var h = parsed.searchParams.get('h')
      return parsed.origin + parsed.pathname + (h ? '?h=' + h : '')
    }
  } catch (ignore) {
    void ignore
  }

  return url
}

// ── Salvar stream capturado ──────────────────────────────────────────────────
function saveStream(url, type, tabId, source) {
  if (!url || !type) return

  chrome.storage.local.get(STREAMS_KEY, function(r) {
    var streams = Array.isArray(r[STREAMS_KEY]) ? r[STREAMS_KEY] : []

    // Deduplicar — normalizar URLs do Vimeo config antes de comparar
    var incomingKey = dedupeKeyForUrl(url, type)
    var exists = streams.some(function(s) {
      return dedupeKeyForUrl(s.url, s.type) === incomingKey
    })
    if (exists) return

    var record = {
      url: url,
      type: type,
      tabId: typeof tabId === 'number' ? tabId : -1,
      source: source || 'background',
      title: '',
      timestamp: Date.now(),
    }

    streams.unshift(record)
    if (streams.length > MAX_STREAMS) streams = streams.slice(0, MAX_STREAMS)

    var payload = {}
    payload[STREAMS_KEY] = streams
    chrome.storage.local.set(payload, function() {
      console.log('[BaixarHSL] stream salvo:', type, url.slice(0, 80))
    })
  })
}

// ── Diagnóstico simples ──────────────────────────────────────────────────────
function logDiag(tabId, kind, url) {
  if (typeof tabId !== 'number' || tabId < 0) return
  chrome.storage.local.get(DIAG_KEY, function(r) {
    var store = r[DIAG_KEY] || {}
    if (!store[tabId]) store[tabId] = { events: [], tabId: tabId }
    store[tabId].events = (store[tabId].events || []).concat({ kind: kind, url: url, ts: Date.now() }).slice(-100)
    var payload = {}
    payload[DIAG_KEY] = store
    chrome.storage.local.set(payload)
  })
}

// ── webRequest: intercepta requisições de rede ──────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    var type = detectMediaType(details.url)
    if (!type) return
    saveStream(details.url, type, details.tabId, 'webRequest')
    logDiag(details.tabId, 'network-' + type, details.url)
  },
  { urls: ['<all_urls>'] }
)

// Também inspeciona headers de resposta (captura por Content-Type)
chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
    var url = details.url || ''
    var lower = url.toLowerCase()

    // Ignorar fragmentos adaptativos e legendas — nunca salvar como stream
    if (
      lower.includes('/range/') ||
      lower.includes('/segment/') ||
      lower.includes('/avf/') ||
      lower.includes('.m4s') ||
      /[?&]range=/.test(lower) ||
      /[?&]ext-subs=/.test(lower)
    ) return

    var ct = ''
    if (Array.isArray(details.responseHeaders)) {
      for (var i = 0; i < details.responseHeaders.length; i++) {
        var h = details.responseHeaders[i]
        if (h && h.name && h.name.toLowerCase() === 'content-type') {
          ct = String(h.value || '').toLowerCase()
          break
        }
      }
    }

    var type = null
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) {
      // Verificar se é playlist Vimeo antes de classificar como HLS
      if (lower.includes('vimeocdn.com') && (lower.includes('playlist.json') || lower.includes('master.json'))) {
        type = 'vimeo'
      } else {
        type = 'hls'
      }
    } else if (ct.includes('dash') || ct.includes('mpd')) {
      type = 'dash'
    } else if (ct.includes('video/mp4') || ct.includes('video/webm')) {
      // Não salvar como progressive se for URL de CDN adaptativo sem ser download direto
      if (lower.includes('vimeocdn.com')) return
      type = 'progressive'
    }

    if (!type) return
    saveStream(url, type, details.tabId, 'headers')
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

// ── Mensagens do content script ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return false

  // Stream capturado pelo interceptor da página
  if (message.action === 'capture-stream') {
    var senderTabId = sender && sender.tab ? sender.tab.id : -1
    var stream = message.stream || {}
    if (stream.url) {
      saveStream(stream.url, stream.type || 'hls', senderTabId, stream.source || 'content')
      logDiag(senderTabId, 'stream-' + (stream.type || 'hls'), stream.url)
    }
    sendResponse({ ok: true })
    return false
  }

  // Cache de body do config Vimeo interceptado na página
  if (message.action === 'cache-vimeo-config') {
    if (message.url && message.body) {
      var vcKey = VIMEO_CFG_KEY_PREFIX + dedupeKeyForUrl(message.url, 'vimeo')
      var vcPayload = {}
      vcPayload[vcKey] = message.body
      chrome.storage.session.set(vcPayload)
      console.log('[BaixarHSL] config Vimeo cacheado:', message.url.slice(0, 80), 'bytes:', message.body.length)
      // Invalidar cache de resolução para forçar re-resolução com o body cacheado
      var resolveKey = 'vimeo::' + message.url
      resolvedCache.delete(resolveKey)
    }
    sendResponse({ ok: true })
    return false
  }

  // Resolver detalhes de manifesto HLS/Vimeo
  if (message.action === 'resolveStreamDetails') {
    resolveStreamDetails(message.stream || {})
      .then(function(details) { sendResponse({ ok: true, details: details }) })
      .catch(function(e) { sendResponse({ ok: false, error: e && e.message || 'Erro' }) })
    return true
  }

  // Download direto (progressive) — com preflight para detectar HTML
  if (message.action === 'downloadResolvedStream') {
    var dlUrl = message.url ? String(message.url) : ''
    if (!dlUrl) { sendResponse({ ok: false, error: 'URL ausente' }); return false }

    fetch(dlUrl, { method: 'HEAD', credentials: 'include', cache: 'no-store' })
      .then(function(r) {
        var ct = (r.headers.get('content-type') || '').toLowerCase()
        if (ct.includes('text/html') || ct.includes('application/xhtml')) {
          sendResponse({ ok: false, error: 'O servidor retornou uma pagina HTML (token expirado ou login necessario). Tente recarregar a pagina do video e clique em Atualizar.' })
          return
        }
        chrome.downloads.download({
          url: dlUrl,
          filename: String(message.filename || 'video.mp4'),
          saveAs: true,
        }, function(id) {
          var err = chrome.runtime.lastError
          if (err) { sendResponse({ ok: false, error: err.message }); return }
          sendResponse({ ok: true, downloadId: id })
        })
      })
      .catch(function() {
        // HEAD falhou (CORS, rede) — tenta download direto assim mesmo
        chrome.downloads.download({
          url: dlUrl,
          filename: String(message.filename || 'video.mp4'),
          saveAs: true,
        }, function(id) {
          var err = chrome.runtime.lastError
          if (err) { sendResponse({ ok: false, error: err.message }); return }
          sendResponse({ ok: true, downloadId: id })
        })
      })
    return true
  }

  // Debug ping
  if (message.action === 'ping') {
    sendResponse({ ok: true, now: Date.now() })
    return false
  }

  // Estado de diagnóstico
  if (message.action === 'getDebugState') {
    chrome.storage.local.get([DIAG_KEY, STREAMS_KEY], function(r) {
      var store = r[DIAG_KEY] || {}
      var tabState = store[message.tabId] || { events: [] }
      sendResponse({
        ok: true,
        state: tabState,
        totalStreams: (r[STREAMS_KEY] || []).length,
      })
    })
    return true
  }

  if (message.action === 'clearDebugState') {
    chrome.storage.local.get(DIAG_KEY, function(r) {
      var store = r[DIAG_KEY] || {}
      delete store[message.tabId]
      var payload = {}
      payload[DIAG_KEY] = store
      chrome.storage.local.set(payload, function() { sendResponse({ ok: true }) })
    })
    return true
  }

  return false
})

// Limpar diagnóstico quando aba fecha
chrome.tabs.onRemoved.addListener(function(tabId) {
  chrome.storage.local.get(DIAG_KEY, function(r) {
    var store = r[DIAG_KEY] || {}
    if (!store[tabId]) return
    delete store[tabId]
    var payload = {}
    payload[DIAG_KEY] = store
    chrome.storage.local.set(payload)
  })
})

// ── Resolver detalhes de manifesto ──────────────────────────────────────────
async function resolveStreamDetails(stream) {
  if (!stream || !stream.url) throw new Error('Nenhum stream para resolver.')

  var cacheKey = stream.type + '::' + stream.url
  if (resolvedCache.has(cacheKey)) return resolvedCache.get(cacheKey)

  var promise = (async function() {
    if (stream.type === 'hls') {
      var hlsApi = self.BaixarHSLHls
      if (!hlsApi) throw new Error('Módulo HLS não carregado.')
      var resp = await fetch(stream.url, { credentials: 'include', cache: 'no-store' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      var text = await resp.text()
      var parsed = hlsApi.resolvePlaylist(text, stream.url)

      if (parsed.kind === 'master' && parsed.variants.length > 0) {
        return {
          canDownloadHls: true,
          isDrmProtected: false,
          options: parsed.variants,
          selectedType: 'hls',
          selectedUrl: parsed.variants[0].url,
          title: stream.title || '',
          thumbnailUrl: stream.thumbnailUrl || '',
          filename: (stream.title || 'video') + '.mp4',
        }
      }

      return {
        canDownloadHls: true,
        isDrmProtected: false,
        options: [{ label: 'Original (HLS)', quality: 'Original', type: 'hls', url: stream.url }],
        selectedType: 'hls',
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    if (stream.type === 'dash') {
      return {
        canDownloadDash: true,
        isDrmProtected: false,
        options: [{ label: 'DASH (MPD)', quality: 'Original', type: 'dash', url: stream.url }],
        selectedType: 'dash',
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    if (stream.type === 'vimeo') {
      var vimeoUrlLower = stream.url.toLowerCase()

      // playlist.json / master.json → segmented Vimeo playlist parser
      // Don't try to use config parser as fallback for playlist.json
      if (vimeoUrlLower.includes('playlist.json') || vimeoUrlLower.includes('master.json')) {
        if (self.BaixarHSLVimeoPlaylist) {
          var playlistResp = await fetch(stream.url, { credentials: 'include', cache: 'no-store' })
          if (!playlistResp.ok) throw new Error('HTTP ' + playlistResp.status)
          var playlistText = await playlistResp.text()
          var playlistDetails = self.BaixarHSLVimeoPlaylist.resolvePlaylistDetails(playlistText, stream.url)
          if (playlistDetails && Array.isArray(playlistDetails.options) && playlistDetails.options.length > 0) {
            return {
              canDownloadVimeoPlaylist: true,
              canDownloadDirect: false,
              canDownloadHls: false,
              canDownloadDash: false,
              isDrmProtected: false,
              options: playlistDetails.options,
              selectedType: 'vimeo-playlist',
              selectedUrl: playlistDetails.selectedUrl,
              title: stream.title || '',
              thumbnailUrl: stream.thumbnailUrl || '',
              filename: (stream.title || 'video') + '.mp4',
            }
          }
        }
        // playlist.json with no downloadable tracks (e.g. all /range/prot/ segments) — skip
        return null
      }

      // /config → use interceptor-cached body if available (avoids Referer/domain issues)
      var configStorageKey = VIMEO_CFG_KEY_PREFIX + dedupeKeyForUrl(stream.url, 'vimeo')
      var sessionData = await new Promise(function(resolve) {
        chrome.storage.session.get(configStorageKey, function(r) { resolve(r || {}) })
      })
      var vimeoText = sessionData[configStorageKey] || null
      if (vimeoText) {
        console.log('[BaixarHSL] usando config Vimeo cacheado para', stream.url.slice(0, 80))
      } else {
        try {
          var vimeoResp = await fetch(stream.url, { credentials: 'include', cache: 'no-store' })
          if (vimeoResp.ok) {
            vimeoText = await vimeoResp.text()
            console.log('[BaixarHSL] config Vimeo buscado via fetch:', stream.url.slice(0, 80))
          } else {
            console.log('[BaixarHSL] config Vimeo fetch falhou HTTP', vimeoResp.status, stream.url.slice(0, 80))
          }
        } catch (fetchErr) {
          console.log('[BaixarHSL] config Vimeo fetch erro:', fetchErr && fetchErr.message)
        }
      }

      // /config → Vimeo player config parser
      if (vimeoText && self.BaixarHSLStreamDetails) {
        var details = self.BaixarHSLStreamDetails.resolveVimeoStreamDetails(vimeoText, stream.url)
        details.title = details.title || stream.title || ''
        details.thumbnailUrl = details.thumbnailUrl || stream.thumbnailUrl || ''
        details.filename = (details.title || 'video') + '.mp4'
        return details
      }

      // Config not available — cannot resolve this Vimeo stream
      return null
    }

    // DRM / MediaSource — não tem download direto
    if (stream.type === 'drm' || stream.type === 'media-source') {
      return {
        isDrmProtected: stream.type === 'drm',
        blockReason: stream.type === 'drm'
          ? 'Conteudo protegido por DRM. A extensao nao pode baixar esse stream.'
          : 'Player com MediaSource detectado. Nao ha URL direta para download.',
        options: [],
        selectedType: stream.type,
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    // Progressive — URL de arquivo de video direto
    return {
      canDownloadDirect: true,
      isDrmProtected: false,
      options: [{ label: 'Download direto', quality: 'Original', type: stream.type || 'progressive', url: stream.url }],
      selectedType: stream.type || 'progressive',
      selectedUrl: stream.url,
      title: stream.title || '',
      thumbnailUrl: stream.thumbnailUrl || '',
      filename: (stream.title || 'video') + '.mp4',
    }
  })().catch(function(e) {
    resolvedCache.delete(cacheKey)
    throw e
  })

  resolvedCache.set(cacheKey, promise)
  return promise
}

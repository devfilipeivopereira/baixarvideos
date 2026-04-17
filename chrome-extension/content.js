console.log('[BaixarHSL] content script carregado')

function getFrameType() {
  try {
    return window.top === window ? 'top' : 'frame'
  } catch {
    return 'frame'
  }
}

function sendRuntimeMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, function(response) {
      void chrome.runtime.lastError
      if (callback) callback(response)
    })
  } catch {
    if (callback) callback(null)
  }
}

function sendDebugEvent(event) {
  sendRuntimeMessage({ action: 'debug-event', event: event })
}

function fallbackSaveStream(match, source) {
  chrome.storage.local.get('streams', function(result) {
    var streams = Array.isArray(result && result.streams) ? result.streams : []
    if (streams.some(function(entry) { return entry.url === match.url && entry.type === match.type })) return

    streams.unshift({
      blockReason: match.blockReason || '',
      isDrmProtected: Boolean(match.isDrmProtected),
      keySystem: match.keySystem || '',
      mimeType: match.mimeType || '',
      source: source || 'page',
      timestamp: Date.now(),
      thumbnailUrl: match.thumbnailUrl || '',
      title: match.title || document.title || '',
      type: match.type,
      url: match.url,
    })

    chrome.storage.local.set({ streams: streams.slice(0, 30) })
  })
}

function saveCapturedMatch(match, source) {
  if (!match || !match.url) return

  console.log('[BaixarHSL] stream capturado:', match.url)

  var eventPayload = {
    frameType: getFrameType(),
    kind: 'stream-found',
    pageTitle: document.title,
    pageUrl: window.location.href,
    source: source || 'content',
    streamType: match.type,
    url: match.url,
  }

  sendDebugEvent(eventPayload)

  sendRuntimeMessage({
    action: 'capture-stream',
    stream: {
      blockReason: match.blockReason || '',
      isDrmProtected: Boolean(match.isDrmProtected),
      keySystem: match.keySystem || '',
      mimeType: match.mimeType || '',
      source: source || 'content',
      thumbnailUrl: match.thumbnailUrl || '',
      timestamp: Date.now(),
      title: match.title || document.title || '',
      type: match.type,
      url: match.url,
    },
  }, function(response) {
    if (!response || !response.ok) {
      fallbackSaveStream(match, source)
    }
  })
}

function collectMatchesFromText(text, source) {
  if (!text) return
  if (!self.BaixarHSLDetector || typeof self.BaixarHSLDetector.extractStreamMatchesFromText !== 'function') return

  var matches = self.BaixarHSLDetector.extractStreamMatchesFromText(text, window.location.href)
  for (var i = 0; i < matches.length; i++) {
    saveCapturedMatch(matches[i], source)
  }
}

function saveDetectedVideoUrl(url, source, extra) {
  if (!self.BaixarHSLDetector || typeof self.BaixarHSLDetector.detectStreamFromRequest !== 'function') return
  var match = self.BaixarHSLDetector.detectStreamFromRequest(url, window.location.href)
  if (!match) return

  saveCapturedMatch({
    blockReason: extra && extra.blockReason ? extra.blockReason : '',
    isDrmProtected: Boolean(extra && extra.isDrmProtected),
    keySystem: extra && extra.keySystem ? extra.keySystem : '',
    mimeType: extra && extra.mimeType ? extra.mimeType : '',
    thumbnailUrl: extra && extra.thumbnailUrl ? extra.thumbnailUrl : '',
    title: extra && extra.title ? extra.title : document.title || '',
    type: match.type,
    url: match.url,
  }, source)
}

function saveMediaSourceStream(url, source, extra) {
  if (!url) return

  saveCapturedMatch({
    blockReason: extra && extra.blockReason ? extra.blockReason : '',
    isDrmProtected: Boolean(extra && extra.isDrmProtected),
    keySystem: extra && extra.keySystem ? extra.keySystem : '',
    mimeType: extra && extra.mimeType ? extra.mimeType : '',
    thumbnailUrl: extra && extra.thumbnailUrl ? extra.thumbnailUrl : '',
    title: extra && extra.title ? extra.title : document.title || '',
    type: extra && extra.isDrmProtected ? 'drm' : 'media-source',
    url: String(url),
  }, source)
}

function scanVideoElements() {
  var videoNodes = document.querySelectorAll('video')
  for (var index = 0; index < videoNodes.length; index += 1) {
    var videoNode = videoNodes[index]
    var poster = videoNode.getAttribute('poster') || ''
    var currentSrc = videoNode.currentSrc || videoNode.getAttribute('src') || ''
    var mediaKeysPresent = Boolean(videoNode.mediaKeys)

    if (currentSrc && /^(blob|mediastream):/i.test(currentSrc)) {
      saveMediaSourceStream(currentSrc, 'dom-video', {
        blockReason: mediaKeysPresent ? 'Conteudo protegido por DRM detectado no player.' : '',
        isDrmProtected: mediaKeysPresent,
        thumbnailUrl: poster,
      })
    } else if (currentSrc) {
      saveDetectedVideoUrl(currentSrc, 'dom-video', {
        blockReason: mediaKeysPresent ? 'Conteudo protegido por DRM detectado no player.' : '',
        isDrmProtected: mediaKeysPresent,
        thumbnailUrl: poster,
      })
    }
  }
}

function scanSourceElements() {
  var sourceNodes = document.querySelectorAll('source')
  for (var index = 0; index < sourceNodes.length; index += 1) {
    var sourceNode = sourceNodes[index]
    var sourceUrl = sourceNode.getAttribute('src') || ''
    if (!sourceUrl) continue

    saveDetectedVideoUrl(sourceUrl, 'dom-source', {
      mimeType: sourceNode.getAttribute('type') || '',
    })
  }
}

function scanPageForEmbeddedStreams(reason) {
  sendDebugEvent({
    detail: reason || 'dom-scan',
    frameType: getFrameType(),
    kind: 'dom-scan',
    pageTitle: document.title,
    pageUrl: window.location.href,
    source: 'content',
  })

  collectMatchesFromText(window.location.href, 'dom-location')
  scanVideoElements()
  scanSourceElements()

  var configNodes = document.querySelectorAll('[data-config-url]')
  for (var index = 0; index < configNodes.length; index += 1) {
    var configNode = configNodes[index]
    var configUrl = configNode.getAttribute('data-config-url')
    if (configUrl) collectMatchesFromText(configUrl, 'dom-config-url')
  }

  var iframeNodes = document.querySelectorAll('iframe[src*="player.vimeo.com/video/"]')
  for (var iframeIndex = 0; iframeIndex < iframeNodes.length; iframeIndex += 1) {
    var iframeSrc = iframeNodes[iframeIndex].getAttribute('src')
    if (iframeSrc) collectMatchesFromText(iframeSrc, 'dom-iframe-src')
  }

  var scriptNodes = document.getElementsByTagName('script')
  for (var scriptIndex = 0; scriptIndex < scriptNodes.length; scriptIndex += 1) {
    var scriptText = scriptNodes[scriptIndex].textContent || ''
    if (!scriptText) continue
    if (!/vimeo|configUrl|config_url|progressive|player\.vimeo\.com/i.test(scriptText)) continue

    collectMatchesFromText(scriptText, 'dom-script')
  }
}

function triggerNavigationScan(reason) {
  sendDebugEvent({
    detail: reason || 'navigation',
    frameType: getFrameType(),
    kind: 'navigation',
    pageTitle: document.title,
    pageUrl: window.location.href,
    source: 'content',
  })

  window.setTimeout(function() {
    scanPageForEmbeddedStreams(reason || 'navigation')
  }, 60)
}

function scheduleDomScans() {
  scanPageForEmbeddedStreams('initial')

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      scanPageForEmbeddedStreams('domcontentloaded')
    }, { once: true })
  } else {
    setTimeout(function() {
      scanPageForEmbeddedStreams('document-ready')
    }, 0)
  }

  window.addEventListener('load', function() {
    scanPageForEmbeddedStreams('load')
  }, { once: true })

  window.addEventListener('popstate', function() {
    triggerNavigationScan('popstate')
  })

  window.addEventListener('hashchange', function() {
    triggerNavigationScan('hashchange')
  })

  setTimeout(function() {
    scanPageForEmbeddedStreams('delayed-1000')
  }, 1000)

  setTimeout(function() {
    scanPageForEmbeddedStreams('delayed-3000')
  }, 3000)

  if (typeof MutationObserver === 'undefined' || !document.documentElement) return

  var pendingScan = 0
  var observer = new MutationObserver(function() {
    if (pendingScan) return
    pendingScan = window.setTimeout(function() {
      pendingScan = 0
      scanPageForEmbeddedStreams('mutation')
    }, 150)
  })

  observer.observe(document.documentElement, {
    attributeFilter: ['src', 'data-config-url'],
    attributes: true,
    childList: true,
    subtree: true,
  })

  setTimeout(function() {
    observer.disconnect()
  }, 5000)
}

sendDebugEvent({
  frameType: getFrameType(),
  kind: 'content-loaded',
  pageTitle: document.title,
  pageUrl: window.location.href,
  source: 'content',
})

window.addEventListener('message', function(event) {
  if (event.source !== window) return

  if (event.data && event.data.__baixarhsl_navigation__) {
    triggerNavigationScan(event.data.detail || 'navigation')
    return
  }

  if (event.data && event.data.__baixarhsl_debug__) {
    sendDebugEvent({
      detail: event.data.detail || '',
      frameType: getFrameType(),
      kind: event.data.kind || 'debug-message',
      pageTitle: document.title,
      pageUrl: window.location.href,
      source: event.data.source || 'interceptor',
      streamType: event.data.streamType || '',
      url: event.data.url || '',
    })
    return
  }

  if (event.data && event.data.__baixarhsl_drm__) {
    saveMediaSourceStream(
      event.data.mediaUrl || window.location.href + '#drm',
      event.data.source || 'interceptor-drm',
      {
        blockReason: 'Conteudo protegido por DRM' + (event.data.keySystem ? ' (' + event.data.keySystem + ')' : '.'),
        isDrmProtected: true,
        keySystem: event.data.keySystem || '',
        mimeType: event.data.mimeType || '',
        thumbnailUrl: event.data.thumbnailUrl || '',
      }
    )
    return
  }

  if (event.data && event.data.__baixarhsl_media_source__) {
    saveMediaSourceStream(
      event.data.url || window.location.href + '#media-source',
      event.data.source || 'interceptor-media-source',
      {
        blockReason: event.data.blockReason || '',
        isDrmProtected: Boolean(event.data.isDrmProtected),
        keySystem: event.data.keySystem || '',
        mimeType: event.data.mimeType || '',
        thumbnailUrl: event.data.thumbnailUrl || '',
      }
    )
    return
  }

  if (event.data && event.data.__baixarhsl_vimeo_config__) {
    if (event.data.url && event.data.body) {
      sendRuntimeMessage({
        action: 'cache-vimeo-config',
        body: event.data.body,
        url: event.data.url,
      })
    }
    return
  }

  if (!event.data || !event.data.__baixarhsl__) return

  if (!self.BaixarHSLDetector || typeof self.BaixarHSLDetector.detectStreamFromRequest !== 'function') return
  var match = self.BaixarHSLDetector.detectStreamFromRequest(event.data.url, window.location.href)
  if (!match) return

  saveCapturedMatch({
    type: event.data.type || match.type,
    url: match.url,
  }, event.data.source || 'content')
})

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || message.action !== 'debug-ping') return false

  sendDebugEvent({
    frameType: getFrameType(),
    kind: 'content-ping',
    pageTitle: document.title,
    pageUrl: window.location.href,
    source: 'content',
  })

  window.postMessage({ __baixarhsl_probe__: true }, '*')
  triggerNavigationScan('debug-ping')

  sendResponse({
    frameType: getFrameType(),
    ok: true,
    pageTitle: document.title,
    pageUrl: window.location.href,
  })
  return false
})

scheduleDomScans()

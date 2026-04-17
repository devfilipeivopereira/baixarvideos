;(function () {
  console.log('[BaixarHSL] interceptor ativo - monitorando XHR e fetch')
  var performanceSeen = Object.create(null)
  var MediaSourceCtor = typeof globalThis.MediaSource !== 'undefined' ? globalThis.MediaSource : null
  var HtmlMediaElementCtor = typeof globalThis.HTMLMediaElement !== 'undefined' ? globalThis.HTMLMediaElement : null
  var originalCreateObjectURL = window.URL && typeof window.URL.createObjectURL === 'function'
    ? window.URL.createObjectURL.bind(window.URL)
    : null

  function getDetector() {
    return window.BaixarHSLInterceptorDetector || window.BaixarHSLDetector || null
  }

  function postDebug(kind, extra) {
    var payload = Object.assign(
      {
        __baixarhsl_debug__: true,
        kind: kind,
        pageUrl: window.location.href,
        source: 'interceptor',
      },
      extra || {}
    )

    window.postMessage(payload, '*')
  }

  function postNavigation(detail) {
    window.postMessage(
      {
        __baixarhsl_navigation__: true,
        detail: detail || 'navigation',
        pageUrl: window.location.href,
      },
      '*'
    )
  }

  function postDrm(extra) {
    window.postMessage(
      Object.assign(
        {
          __baixarhsl_drm__: true,
          pageUrl: window.location.href,
          source: 'interceptor',
        },
        extra || {}
      ),
      '*'
    )
  }

  function postMediaSource(extra) {
    window.postMessage(
      Object.assign(
        {
          __baixarhsl_media_source__: true,
          pageUrl: window.location.href,
          source: 'interceptor',
        },
        extra || {}
      ),
      '*'
    )
  }

  function isRelevantUrl(url) {
    var lower = String(url || '').toLowerCase()
    return (
      lower.includes('.m3u8') ||
      lower.includes('.mpd') ||
      lower.includes('vimeo') ||
      lower.includes('/config') ||
      lower.includes('master.json') ||
      lower.includes('manifest') ||
      lower.includes('playlist')
    )
  }

  function postMatch(match, source) {
    if (!match) return

    console.log('[BaixarHSL] manifesto detectado:', match.url)
    window.postMessage(
      { __baixarhsl__: true, source: source, type: match.type, url: match.url },
      '*'
    )
  }

  function notify(url, source) {
    if (isRelevantUrl(url)) {
      postDebug('network-request', { detail: source || '', url: String(url || '') })
    }

    var detector = getDetector()
    if (!detector || typeof detector.detectStreamFromRequest !== 'function') {
      postDebug('error', {
        detail: 'detector indisponivel no MAIN world',
        url: String(url || ''),
      })
      return
    }

    var match = detector.detectStreamFromRequest(url, window.location.href)
    postMatch(match, source)
  }

  function shouldInspectResponseBody(url, contentType, contentLength) {
    var lowerUrl = String(url || '').toLowerCase()
    var lowerType = String(contentType || '').toLowerCase()
    var size = Number(contentLength || 0)

    if (size > 500000) return false

    if (lowerType.includes('json') || lowerType.includes('text') || lowerType.includes('javascript')) {
      return true
    }

    return (
      lowerUrl.includes('vimeo') ||
      lowerUrl.includes('/config') ||
      lowerUrl.includes('master.json') ||
      lowerUrl.includes('manifest')
    )
  }

  function isVimeoConfigUrl(url) {
    return /player\.vimeo\.com\/video\/\d+\/config(?:[?#]|$)/i.test(String(url || ''))
  }

  function inspectTextResponse(url, contentType, body, source) {
    if (!shouldInspectResponseBody(url, contentType, body ? body.length : 0)) return
    if (!body || body.length > 500000) return

    postDebug('body-inspected', { detail: contentType || '', url: url })

    // Cache Vimeo config bodies so background can resolve without re-fetching
    if (isVimeoConfigUrl(url)) {
      window.postMessage({
        __baixarhsl_vimeo_config__: true,
        body: body,
        source: 'interceptor',
        url: url,
      }, '*')
    }

    var detector = getDetector()
    if (!detector || typeof detector.extractStreamMatchesFromText !== 'function') {
      postDebug('error', {
        detail: 'extractor indisponivel no MAIN world',
        url: url,
      })
      return
    }

    var matches = detector.extractStreamMatchesFromText(body, url)
    for (var i = 0; i < matches.length; i++) {
      postMatch(matches[i], source)
    }
  }

  function inspectFetchResponse(response, source) {
    try {
      var contentType = response.headers.get('content-type') || ''
      var contentLength = response.headers.get('content-length') || ''
      if (!shouldInspectResponseBody(response.url, contentType, contentLength)) return

      response
        .clone()
        .text()
        .then(function(body) {
          inspectTextResponse(response.url, contentType, body, source)
        })
        .catch(function(error) {
          postDebug('error', {
            detail: error && error.message ? error.message : 'falha ao ler body do fetch',
            url: response.url,
          })
        })
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha ao inspecionar fetch',
        url: response && response.url || '',
      })
    }
  }

  function inspectXhrResponse(xhr) {
    try {
      var responseUrl = xhr.responseURL || xhr.__baixarhslRequestUrl || ''
      var contentType = xhr.getResponseHeader('content-type') || ''
      var body = ''

      if (xhr.responseType === '' || xhr.responseType === 'text') {
        body = xhr.responseText || ''
      } else if (xhr.responseType === 'json' && xhr.response) {
        body = JSON.stringify(xhr.response)
      } else {
        return
      }

      inspectTextResponse(responseUrl, contentType, body, 'xhr-response')
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha ao inspecionar xhr',
        url: xhr && (xhr.responseURL || xhr.__baixarhslRequestUrl || '') || '',
      })
    }
  }

  function announceNavigation(detail) {
    postDebug('navigation', { detail: detail || 'navigation', url: window.location.href })
    postNavigation(detail)
  }

  function patchHistoryMethod(methodName, originalMethod) {
    if (typeof originalMethod !== 'function') return

    history[methodName] = function () {
      var result = originalMethod.apply(this, arguments)
      setTimeout(function() {
        announceNavigation(methodName)
      }, 0)
      return result
    }
  }

  function observePerformanceEntries() {
    if (typeof PerformanceObserver === 'undefined') return

    try {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries()
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (!entry || !entry.name || performanceSeen[entry.name]) continue
          if (!isRelevantUrl(entry.name)) continue

          performanceSeen[entry.name] = true
          notify(entry.name, 'performance-' + String(entry.initiatorType || 'resource'))
        }
      })

      observer.observe({ entryTypes: ['resource'], buffered: true })
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha ao iniciar PerformanceObserver',
        url: window.location.href,
      })
    }
  }

  window.addEventListener('message', function(event) {
    if (event.source !== window) return
    if (!event.data || !event.data.__baixarhsl_probe__) return
    postDebug('interceptor-pong', { detail: 'probe' })
  })

  window.addEventListener('popstate', function() {
    announceNavigation('popstate')
  })

  window.addEventListener('hashchange', function() {
    announceNavigation('hashchange')
  })

  var originalPushState = history.pushState
  var originalReplaceState = history.replaceState
  patchHistoryMethod('pushState', originalPushState)
  patchHistoryMethod('replaceState', originalReplaceState)
  observePerformanceEntries()

  postDebug('interceptor-loaded')

  var origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function () {
    try {
      this.__baixarhslRequestUrl = String(arguments[1] || '')
      notify(this.__baixarhslRequestUrl, 'xhr-request')
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha em xhr.open',
        url: String(arguments[1] || ''),
      })
    }
    return origOpen.apply(this, arguments)
  }

  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    try {
      if (!this.__baixarhslListenerAttached) {
        this.__baixarhslListenerAttached = true
        this.addEventListener('loadend', function() {
          inspectXhrResponse(this)
        })
      }
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha em xhr.send',
        url: this && this.__baixarhslRequestUrl || '',
      })
    }

    return origSend.apply(this, arguments)
  }

  var origFetch = window.fetch
  window.fetch = function (input) {
    var url = ''

    try {
      if (typeof input === 'string') {
        url = input
      } else if (input instanceof Request) {
        url = input.url
      } else if (input && typeof input.url === 'string') {
        url = input.url
      } else if (input) {
        url = String(input)
      }

      notify(url, 'fetch-request')
    } catch (error) {
      postDebug('error', {
        detail: error && error.message ? error.message : 'falha ao analisar fetch',
        url: url,
      })
    }

    return origFetch.apply(this, arguments)
      .then(function(response) {
        inspectFetchResponse(response, 'fetch-response')
        return response
      })
      .catch(function(error) {
        postDebug('error', {
          detail: error && error.message ? error.message : 'falha no fetch',
          url: url,
        })
        throw error
      })
  }

  if (window.URL && originalCreateObjectURL) {
    window.URL.createObjectURL = function(object) {
      var objectUrl = originalCreateObjectURL(object)

      if (MediaSourceCtor && object instanceof MediaSourceCtor) {
        postDebug('media-source', { detail: 'createObjectURL', url: objectUrl })
        postMediaSource({ url: objectUrl })
      }

      return objectUrl
    }
  }

  if (MediaSourceCtor && MediaSourceCtor.prototype && typeof MediaSourceCtor.prototype.addSourceBuffer === 'function') {
    var originalAddSourceBuffer = MediaSourceCtor.prototype.addSourceBuffer
    MediaSourceCtor.prototype.addSourceBuffer = function(mimeType) {
      postDebug('media-source', {
        detail: String(mimeType || ''),
        url: window.location.href,
      })
      postMediaSource({
        mimeType: String(mimeType || ''),
        url: window.location.href + '#media-source',
      })
      return originalAddSourceBuffer.apply(this, arguments)
    }
  }

  if (typeof navigator.requestMediaKeySystemAccess === 'function') {
    var originalRequestMediaKeySystemAccess = navigator.requestMediaKeySystemAccess.bind(navigator)
    navigator.requestMediaKeySystemAccess = function(keySystem) {
      postDebug('drm-detected', {
        detail: String(keySystem || ''),
        url: window.location.href,
      })
      postDrm({
        keySystem: String(keySystem || ''),
        mediaUrl: window.location.href + '#drm',
      })
      return originalRequestMediaKeySystemAccess.apply(this, arguments)
    }
  }

  if (
    HtmlMediaElementCtor &&
    HtmlMediaElementCtor.prototype &&
    typeof HtmlMediaElementCtor.prototype.setMediaKeys === 'function'
  ) {
    var originalSetMediaKeys = HtmlMediaElementCtor.prototype.setMediaKeys
    HtmlMediaElementCtor.prototype.setMediaKeys = function(mediaKeys) {
      if (mediaKeys) {
        var mediaUrl = this.currentSrc || this.src || window.location.href + '#drm'
        postDebug('drm-detected', {
          detail: 'setMediaKeys',
          url: mediaUrl,
        })
        postDrm({
          keySystem: '',
          mediaUrl: mediaUrl,
        })
      }

      return originalSetMediaKeys.apply(this, arguments)
    }
  }
})()

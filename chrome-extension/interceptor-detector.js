;(function(root) {
  function toAbsoluteUrl(url, baseUrl) {
    if (!url) return null

    var raw = String(url).trim()
    if (!raw) return null

    try {
      return baseUrl ? new URL(raw, baseUrl).href : new URL(raw).href
    } catch {
      return null
    }
  }

  function shouldIgnoreUrl(url) {
    return /^(blob|data|mediastream):/i.test(url)
  }

  function isVimeoPlayerConfigUrl(url) {
    return /^https?:\/\/player\.vimeo\.com\/video\/\d+\/config(?:[?#]|$)/i.test(String(url || ''))
  }

  function isPartialMediaFragmentUrl(url) {
    var lower = String(url || '').toLowerCase()
    return (
      lower.includes('/range/') ||
      lower.includes('/segment/') ||
      lower.includes('/avf/') ||
      lower.includes('.m4s') ||
      /[?&]range=/.test(lower)
    )
  }

  function buildVimeoConfigUrl(url, baseUrl) {
    var absoluteUrl = toAbsoluteUrl(url, baseUrl)
    if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null

    if (isVimeoPlayerConfigUrl(absoluteUrl)) return absoluteUrl

    var match = /^(https?:\/\/player\.vimeo\.com\/video\/\d+)(\?[^#]*)?(#.*)?$/i.exec(absoluteUrl)
    if (!match) return null

    return match[1] + '/config' + (match[2] || '')
  }

  function detectTypeFromUrl(url) {
    var lower = String(url || '').toLowerCase()
    if (lower.includes('.m3u8')) return 'hls'
    if (lower.includes('.mpd')) return 'dash'
    if (/\.ism\//i.test(lower)) return 'hls'
    if (isVimeoPlayerConfigUrl(url)) return 'vimeo'
    if (lower.includes('vimeocdn.com') && (lower.includes('/playlist.json') || lower.includes('/master.json'))) {
      return 'vimeo'
    }
    // BunnyCDN Media Cage: manifesto HLS com extensão .drm
    if (/iframe\.mediadelivery\.net|video\.bunnycdn\.com/i.test(lower) && lower.includes('video.drm')) return 'hls'
    if (/\.(mp4|webm|mov|m4v|mkv|ogv|ogg|avi|flv)(?:[?#]|$)/i.test(lower)) return 'progressive'
    return null
  }

  function pushUniqueMatch(results, seen, url, baseUrl, api) {
    var match = api.detectStreamFromRequest(url, baseUrl)
    if (!match) return
    if (seen[match.url]) return

    seen[match.url] = true
    results.push(match)
  }

  function createFallbackDetector() {
    var api = {
      detectStreamFromRequest: function(url, baseUrl) {
        var absoluteUrl = toAbsoluteUrl(url, baseUrl)
        if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null
        if (isPartialMediaFragmentUrl(absoluteUrl)) return null

        var type = detectTypeFromUrl(absoluteUrl)
        if (!type) return null

        return { url: absoluteUrl, type: type }
      },
      extractStreamMatchesFromText: function(text, baseUrl) {
        if (!text) return []

        var normalized = String(text).replace(/\\\//g, '/')
        var results = []
        var seen = Object.create(null)
        var absoluteRegex = /https?:\/\/[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
        var relativeRegex = /(?:\/|\.\.?\/)[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
        var vimeoAbsoluteRegex = /https?:\/\/player\.vimeo\.com\/video\/\d+(?:\/config)?(?:\?[^"'\\\s<]*)?/gi
        var match

        while ((match = absoluteRegex.exec(normalized))) {
          pushUniqueMatch(results, seen, match[0], baseUrl, api)
        }

        while ((match = relativeRegex.exec(normalized))) {
          pushUniqueMatch(results, seen, match[0], baseUrl, api)
        }

        while ((match = vimeoAbsoluteRegex.exec(normalized))) {
          var configUrl = buildVimeoConfigUrl(match[0], baseUrl)
          if (!configUrl) continue
          pushUniqueMatch(results, seen, configUrl, baseUrl, api)
        }

        return results
      },
    }

    return api
  }

  function createInterceptorDetector(existingDetector) {
    if (
      existingDetector &&
      typeof existingDetector.detectStreamFromRequest === 'function' &&
      typeof existingDetector.extractStreamMatchesFromText === 'function'
    ) {
      return existingDetector
    }

    return createFallbackDetector()
  }

  var api = {
    createInterceptorDetector: createInterceptorDetector,
  }

  root.BaixarHSLInterceptorDetector = createInterceptorDetector(root.BaixarHSLDetector)

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

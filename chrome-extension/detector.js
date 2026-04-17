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
      /[?&]range=/.test(lower) ||
      /[?&]ext-subs=/.test(lower)
    )
  }

  function isDirectVideoUrl(url) {
    return /\.(mp4|webm|mov|m4v|mkv|ogv|ogg|avi|flv)(?:[?#]|$)/i.test(String(url || ''))
  }

  function isSmoothStreamingUrl(url) {
    return /\.ism\//i.test(String(url || ''))
  }

  function buildVimeoConfigUrl(url, baseUrl) {
    var absoluteUrl = toAbsoluteUrl(url, baseUrl)
    if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null

    if (isVimeoPlayerConfigUrl(absoluteUrl)) return absoluteUrl

    var match = /^(https?:\/\/player\.vimeo\.com\/video\/\d+)(\?[^#]*)?(#.*)?$/i.exec(absoluteUrl)
    if (!match) return null

    return match[1] + '/config' + (match[2] || '')
  }

  function isBrazilianPlatformUrl(url) {
    var lower = String(url || '').toLowerCase()
    if (/pandavideo\.com\.br|pandacdn\.com/i.test(lower)) return true
    if (/hotmart\.com|hotmartios\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8') || lower.includes('.mpd'))) return true
    if (/herospark\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/eduzz\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/kiwify\.com\.br/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/curseduca\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/estrategia\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/brightcove\.net|bcovlive\.io/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8') || lower.includes('.mpd'))) return true
    if (/sparkle\.io/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return true
    if (/sambatech\.com\.br|sambavideos\.com\.br/i.test(lower)) return true
    if (/vdocipher\.com/i.test(lower) && lower.includes('.m3u8')) return true
    if (/jwpcdn\.com|jwplatform\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8') || lower.includes('.mpd'))) return true
    // BunnyCDN Media Cage: iframe.mediadelivery.net e video.bunnycdn.com
    // O manifesto HLS é servido com extensão .drm (e.g. video.drm?contextId=...)
    if (/iframe\.mediadelivery\.net|video\.bunnycdn\.com/i.test(lower) && (lower.includes('video.drm') || lower.includes('.m3u8'))) return true
    // Panda Video (CDN própria)
    if (/p-cdn\.com|b-cdn\.net/i.test(lower) && (lower.includes('.m3u8') || lower.includes('manifest'))) return true
    return false
  }

  function detectTypeFromUrl(url) {
    var lower = url.toLowerCase()
    if (lower.includes('.m3u8')) return 'hls'
    if (lower.includes('.mpd')) return 'dash'
    if (isSmoothStreamingUrl(url)) return 'hls'
    if (isVimeoPlayerConfigUrl(url)) return 'vimeo'
    if (lower.includes('vimeocdn.com') && (lower.includes('/playlist.json') || lower.includes('/master.json'))) {
      return 'vimeo'
    }
    // BunnyCDN video.drm é um manifesto HLS com extensão diferente
    if (/iframe\.mediadelivery\.net|video\.bunnycdn\.com/i.test(lower) && lower.includes('video.drm')) return 'hls'
    if (isBrazilianPlatformUrl(url)) return 'hls'
    if (isDirectVideoUrl(url)) return 'progressive'
    return null
  }

  function getHeaderValue(headers, name) {
    if (!Array.isArray(headers)) return ''

    var lowerName = String(name).toLowerCase()
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i]
      if (!header || typeof header.name !== 'string') continue
      if (header.name.toLowerCase() !== lowerName) continue
      return String(header.value || '')
    }

    return ''
  }

  function detectTypeFromContentType(contentType) {
    var lower = String(contentType || '').toLowerCase()
    if (!lower) return null

    if (
      lower.includes('application/vnd.apple.mpegurl') ||
      lower.includes('application/x-mpegurl') ||
      lower.includes('audio/mpegurl') ||
      lower.includes('audio/x-mpegurl')
    ) {
      return 'hls'
    }

    if (lower.includes('application/dash+xml')) {
      return 'dash'
    }

    if (lower.includes('video/')) {
      return 'progressive'
    }

    return null
  }

  function pushUniqueMatch(results, seen, url, baseUrl) {
    var match = detectStreamFromRequest(url, baseUrl)
    if (!match) return
    if (seen[match.url]) return

    seen[match.url] = true
    results.push(match)
  }

  function pushUniqueVimeoConfigMatch(results, seen, url, baseUrl) {
    var configUrl = buildVimeoConfigUrl(url, baseUrl)
    if (!configUrl) return
    if (seen[configUrl]) return

    var match = detectStreamFromRequest(configUrl, baseUrl)
    if (!match) return

    seen[match.url] = true
    results.push(match)
  }

  function extractStreamMatchesFromText(text, baseUrl) {
    if (!text) return []

    var normalized = String(text).replace(/\\\//g, '/')
    var results = []
    var seen = Object.create(null)
    var absoluteRegex = /https?:\/\/[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
    var relativeRegex = /(?:\/|\.\.?\/)[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
    var vimeoAbsoluteRegex = /https?:\/\/player\.vimeo\.com\/video\/\d+(?:\/config)?(?:\?[^"'\\\s<]*)?/gi
    var match

    while ((match = absoluteRegex.exec(normalized))) {
      pushUniqueMatch(results, seen, match[0], baseUrl)
    }

    while ((match = relativeRegex.exec(normalized))) {
      pushUniqueMatch(results, seen, match[0], baseUrl)
    }

    while ((match = vimeoAbsoluteRegex.exec(normalized))) {
      pushUniqueVimeoConfigMatch(results, seen, match[0], baseUrl)
    }

    return results
  }

  function detectStreamFromRequest(url, baseUrl) {
    var absoluteUrl = toAbsoluteUrl(url, baseUrl)
    if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null
    if (isPartialMediaFragmentUrl(absoluteUrl)) return null

    var type = detectTypeFromUrl(absoluteUrl)
    if (!type) return null

    return { url: absoluteUrl, type: type }
  }

  function detectStreamFromResponseHeaders(details) {
    if (!details || !details.url) return null

    var fromRequest = detectStreamFromRequest(details.url)
    if (fromRequest) return fromRequest

    var absoluteUrl = toAbsoluteUrl(details.url)
    if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null
    if (isPartialMediaFragmentUrl(absoluteUrl)) return null

    var type = detectTypeFromContentType(getHeaderValue(details.responseHeaders, 'content-type'))
    if (!type) return null

    return { url: absoluteUrl, type: type }
  }

  var api = {
    buildVimeoConfigUrl: buildVimeoConfigUrl,
    detectStreamFromRequest: detectStreamFromRequest,
    detectStreamFromResponseHeaders: detectStreamFromResponseHeaders,
    extractStreamMatchesFromText: extractStreamMatchesFromText,
  }

  root.BaixarHSLDetector = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

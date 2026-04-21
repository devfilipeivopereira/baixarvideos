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

  function safeDecodeURIComponent(value) {
    if (typeof value !== 'string') return ''
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  function getParsedUrl(url) {
    try {
      return new URL(String(url || ''))
    } catch {
      return null
    }
  }

  function isGoogleVideoPlaybackUrl(url) {
    var parsed = getParsedUrl(url)
    if (!parsed) return false

    var host = parsed.hostname.toLowerCase()
    if (!host.includes('googlevideo.com')) return false

    return parsed.pathname.toLowerCase().includes('/videoplayback')
  }

  function isYoutubeAudioItag(itagValue) {
    var itag = String(itagValue || '').trim()
    if (!itag) return false

    var audioOnlyItags = {
      '139': true,
      '140': true,
      '141': true,
      '249': true,
      '250': true,
      '251': true,
      '256': true,
      '258': true,
      '325': true,
      '328': true,
    }

    return Boolean(audioOnlyItags[itag])
  }

  function hasUndecipheredYoutubeSignature(url) {
    if (!isGoogleVideoPlaybackUrl(url)) return false

    var parsed = getParsedUrl(url)
    if (!parsed) return false

    var hasCipherSig = parsed.searchParams.has('s')
    var hasResolvedSig = parsed.searchParams.has('sig') || parsed.searchParams.has('signature') || parsed.searchParams.has('lsig')
    return hasCipherSig && !hasResolvedSig
  }

  function isGoogleVideoDirectVideoUrl(url) {
    if (!isGoogleVideoPlaybackUrl(url)) return false

    var parsed = getParsedUrl(url)
    if (!parsed) return false

    var rawMime = String(parsed.searchParams.get('mime') || '').trim()
    var decodedMime = safeDecodeURIComponent(rawMime).toLowerCase()

    if (decodedMime) {
      if (decodedMime.indexOf('video/') === 0) return true
      if (decodedMime.indexOf('audio/') === 0) return false
    }

    var lowerSearch = parsed.search.toLowerCase()
    if (lowerSearch.includes('mime=video%2f') || lowerSearch.includes('mime=video/')) return true
    if (lowerSearch.includes('mime=audio%2f') || lowerSearch.includes('mime=audio/')) return false

    if (isYoutubeAudioItag(parsed.searchParams.get('itag'))) return false

    return (
      parsed.searchParams.has('itag') &&
      String(parsed.searchParams.get('source') || '').toLowerCase() === 'youtube'
    )
  }

  function getDecodedCandidateUrl(candidate) {
    var value = String(candidate || '')
    if (!value) return ''
    if (!/https(?:%3a|%253a)/i.test(value)) return ''

    var decoded = value
    for (var attempt = 0; attempt < 2; attempt++) {
      var next = safeDecodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }

    return decoded
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
    if (isGoogleVideoDirectVideoUrl(url)) return 'progressive'
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

  function pushUniqueMatchWithDecoding(results, seen, url, baseUrl, api) {
    if (!url) return

    pushUniqueMatch(results, seen, url, baseUrl, api)

    var decoded = getDecodedCandidateUrl(url)
    if (!decoded || decoded === url) return

    pushUniqueMatch(results, seen, decoded, baseUrl, api)
  }

  function createFallbackDetector() {
    var api = {
      detectStreamFromRequest: function(url, baseUrl) {
        var absoluteUrl = toAbsoluteUrl(url, baseUrl)
        if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null
        if (isPartialMediaFragmentUrl(absoluteUrl)) return null
        if (hasUndecipheredYoutubeSignature(absoluteUrl)) return null

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
        var youtubeAbsoluteRegex = /https?:\/\/[^"'\\\s]*?googlevideo\.com\/videoplayback[^"'\\\s]*/gi
        var youtubeEncodedRegex = /https(?:%3A|%253A)%2F(?:%2F|%252F)[^"'\\\s]*?googlevideo(?:%2E|\.|%252E)com(?:%2F|\/|%252F)videoplayback[^"'\\\s]*/gi
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

        while ((match = youtubeAbsoluteRegex.exec(normalized))) {
          pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl, api)
        }

        while ((match = youtubeEncodedRegex.exec(normalized))) {
          pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl, api)
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

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
    return /^(blob|data|mediastream):/i.test(url) || isKnownNonMediaPageUrl(url)
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

  function inferVimeoPlaylistFromRangeUrl(url, baseUrl) {
    var raw = String(url || '').trim()
    if (!raw) return null

    var absoluteCandidate = raw
    if (!/^https?:\/\//i.test(absoluteCandidate)) {
      absoluteCandidate = toAbsoluteUrl(absoluteCandidate, baseUrl)
      if (!absoluteCandidate) return null
    }

    var rawWithoutHash = absoluteCandidate.split('#')[0]
    var prefixMatch = /^(https?:\/\/[^?#]+?\/v2\/playlist\/av\/primary\/prot\/[^/?#]+)\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/range\/prot\//i.exec(rawWithoutHash)
    if (!prefixMatch || !prefixMatch[1]) return null

    var playlistUrl = prefixMatch[1] + '/playlist.json'
    var parsed = getParsedUrl(absoluteCandidate)
    if (!parsed) return playlistUrl

    var queryParts = []
    parsed.searchParams.forEach(function(value, key) {
      if (!key) return
      if (String(key).toLowerCase() === 'range') return
      queryParts.push(
        encodeURIComponent(String(key)) + '=' + encodeURIComponent(String(value || ''))
      )
    })

    if (queryParts.length > 0) {
      playlistUrl += '?' + queryParts.join('&')
    }

    return playlistUrl
  }

  function isDirectVideoUrl(url) {
    var parsed = getParsedUrl(url)
    if (!parsed) {
      return /\.(mp4|webm|mov|m4v|mkv|ogv|ogg|avi|flv)(?:[?#]|$)/i.test(String(url || ''))
    }

    var pathname = String(parsed.pathname || '')
    if (/\.(mp4|webm|mov|m4v|mkv|ogv|ogg|avi|flv)$/i.test(pathname)) return true

    var directFileParams = ['download', 'file', 'filename', 'media', 'media_url', 'source', 'src', 'url']
    for (var i = 0; i < directFileParams.length; i += 1) {
      var paramValue = String(parsed.searchParams.get(directFileParams[i]) || '')
      if (/\.(mp4|webm|mov|m4v|mkv|ogv|ogg|avi|flv)(?:[?#]|$)/i.test(paramValue)) return true
    }

    return false
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

  function hostMatchesDomain(hostname, domain) {
    var host = String(hostname || '').toLowerCase()
    var normalizedDomain = String(domain || '').toLowerCase()
    if (!host || !normalizedDomain) return false

    return host === normalizedDomain || host.endsWith('.' + normalizedDomain)
  }

  function isStaticAssetUrl(url) {
    var parsed = getParsedUrl(url)
    if (!parsed) return false
    return String(parsed.pathname || '').toLowerCase().includes('/_next/static/')
  }

  function isKnownHotmartEmbedUrl(url) {
    var parsed = getParsedUrl(url)
    if (!parsed) return false

    var host = String(parsed.hostname || '').toLowerCase()
    var path = String(parsed.pathname || '').toLowerCase()
    return (
      (hostMatchesDomain(host, 'cf-embed.play.hotmart.com') ||
        hostMatchesDomain(host, 'static-embed.play.hotmart.com')) &&
      path.startsWith('/embed/')
    )
  }

  function isKnownNonMediaPageUrl(url) {
    return isStaticAssetUrl(url) || isKnownHotmartEmbedUrl(url)
  }

  function isKnownSocialDirectVideoUrl(url) {
    var parsed = getParsedUrl(url)
    if (!parsed) return false

    var host = parsed.hostname.toLowerCase()
    var path = parsed.pathname.toLowerCase()
    var search = parsed.search.toLowerCase()

    var hasVideoMime = (
      parsed.searchParams.get('mime') === 'video/mp4' ||
      search.includes('mime=video%2f') ||
      search.includes('mime=video/') ||
      search.includes('mime_type=video') ||
      search.includes('content_type=video')
    )

    if (hostMatchesDomain(host, 'facebook.com') && path.includes('/video/playback')) return true

    if (
      hostMatchesDomain(host, 'video.twimg.com') &&
      (path.includes('/ext_tw_video/') || path.includes('/amplify_video/') || path.includes('/tweet_video/'))
    ) {
      return true
    }

    if (
      (hostMatchesDomain(host, 'tiktokcdn.com') ||
        hostMatchesDomain(host, 'tiktokv.com') ||
        hostMatchesDomain(host, 'byteoversea.com') ||
        host.includes('tiktokcdn') ||
        host.includes('bytecdn')) &&
      (path.includes('/video/') || path.includes('/tos/') || path.includes('/obj/tos/') || hasVideoMime)
    ) {
      return true
    }

    if (
      hostMatchesDomain(host, 'cdninstagram.com') &&
      (path.includes('t50.2886-16') || path.includes('/video') || hasVideoMime)
    ) {
      return true
    }

    return false
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
    if (isGoogleVideoDirectVideoUrl(url)) return 'progressive'
    if (isKnownSocialDirectVideoUrl(url)) return 'progressive'
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

  function pushUniqueMatchWithDecoding(results, seen, url, baseUrl) {
    if (!url) return

    pushUniqueMatch(results, seen, url, baseUrl)

    var decoded = getDecodedCandidateUrl(url)
    if (!decoded || decoded === url) return

    pushUniqueMatch(results, seen, decoded, baseUrl)
  }

  function extractStreamMatchesFromText(text, baseUrl) {
    if (!text) return []

    var normalized = String(text).replace(/\\\//g, '/')
    var results = []
    var seen = Object.create(null)
    var absoluteRegex = /https?:\/\/[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
    var relativeRegex = /(?:\/|\.\.?\/)[^"'\\\s]+?(?:\.m3u8|\.mpd|(?:playlist|master)\.json|\.mp4|\.webm|\.mov|\.m4v|\.ogv|\.ogg)(?:\?[^"'\\\s]*)?/gi
    var vimeoAbsoluteRegex = /https?:\/\/player\.vimeo\.com\/video\/\d+(?:\/config)?(?:\?[^"'\\\s<]*)?/gi
    var youtubeAbsoluteRegex = /https?:\/\/[^"'\\\s]*?googlevideo\.com\/videoplayback[^"'\\\s]*/gi
    var youtubeEncodedRegex = /https(?:%3A|%253A)%2F(?:%2F|%252F)[^"'\\\s]*?googlevideo(?:%2E|\.|%252E)com(?:%2F|\/|%252F)videoplayback[^"'\\\s]*/gi
    var socialAbsoluteRegex = /https?:\/\/[^"'\\\s]*?(?:cdninstagram\.com|facebook\.com\/video\/playback|video\.twimg\.com|tiktokcdn\.com|tiktokv\.com|byteoversea\.com)[^"'\\\s]*/gi
    var socialEncodedRegex = /https(?:%3A|%253A)%2F(?:%2F|%252F)[^"'\\\s]*?(?:cdninstagram(?:%2E|\.|%252E)com|facebook(?:%2E|\.|%252E)com(?:%2F|\/|%252F)video(?:%2F|\/|%252F)playback|video(?:%2E|\.|%252E)twimg(?:%2E|\.|%252E)com|tiktokcdn(?:%2E|\.|%252E)com|tiktokv(?:%2E|\.|%252E)com|byteoversea(?:%2E|\.|%252E)com)[^"'\\\s]*/gi
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

    while ((match = youtubeAbsoluteRegex.exec(normalized))) {
      pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl)
    }

    while ((match = youtubeEncodedRegex.exec(normalized))) {
      pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl)
    }

    while ((match = socialAbsoluteRegex.exec(normalized))) {
      pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl)
    }

    while ((match = socialEncodedRegex.exec(normalized))) {
      pushUniqueMatchWithDecoding(results, seen, match[0], baseUrl)
    }

    return results
  }

  function detectStreamFromRequest(url, baseUrl) {
    var inferredVimeoPlaylistUrl = inferVimeoPlaylistFromRangeUrl(url, baseUrl)
    if (inferredVimeoPlaylistUrl) {
      return { url: inferredVimeoPlaylistUrl, type: 'vimeo' }
    }

    var absoluteUrl = toAbsoluteUrl(url, baseUrl)
    if (!absoluteUrl || shouldIgnoreUrl(absoluteUrl)) return null
    if (isPartialMediaFragmentUrl(absoluteUrl)) return null
    if (hasUndecipheredYoutubeSignature(absoluteUrl)) return null

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
    inferVimeoPlaylistFromRangeUrl: inferVimeoPlaylistFromRangeUrl,
  }

  root.BaixarHSLDetector = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

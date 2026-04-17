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

  function toNumber(value) {
    var number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : []
  }

  function appendBase64InitParam(url) {
    var absoluteUrl = toAbsoluteUrl(url)
    if (!absoluteUrl) return null

    var parsedUrl = new URL(absoluteUrl)
    if (!parsedUrl.searchParams.has('base64_init')) {
      parsedUrl.searchParams.set('base64_init', '1')
    }

    return parsedUrl.href
  }

  function extractPlaylistRootUrl(playlistUrl) {
    var absoluteUrl = toAbsoluteUrl(playlistUrl)
    if (!absoluteUrl) return null

    var withoutQuery = absoluteUrl.split('?')[0]
    var match = withoutQuery.match(/^(https?:\/\/.+?\/[^/]+\/)v\d+\//i)
    if (match && match[1]) return match[1]

    return withoutQuery
  }

  function extractPlaylistDirectoryUrl(playlistUrl) {
    var absoluteUrl = toAbsoluteUrl(playlistUrl)
    if (!absoluteUrl) return null

    try {
      var parsed = new URL(absoluteUrl)
      parsed.hash = ''
      parsed.search = ''
      var pathname = parsed.pathname || '/'
      var lastSlashIndex = pathname.lastIndexOf('/')
      parsed.pathname = lastSlashIndex >= 0 ? pathname.slice(0, lastSlashIndex + 1) : '/'
      return parsed.href
    } catch {
      return null
    }
  }

  function buildTrackBaseUrl(playlistUrl, playlistBaseUrl, trackBaseUrl) {
    var playlistDirectoryUrl = extractPlaylistDirectoryUrl(playlistUrl)
    var rootUrl = extractPlaylistRootUrl(playlistUrl)
    var baseUrl = playlistDirectoryUrl || rootUrl
    if (!baseUrl) return null

    if (playlistBaseUrl) {
      baseUrl = toAbsoluteUrl(playlistBaseUrl, baseUrl) || baseUrl
    }

    if (trackBaseUrl) {
      var trackRaw = String(trackBaseUrl).trim()
      var trackStartsAtV2 = /^v\d+\//i.test(trackRaw)
      if (trackStartsAtV2 && rootUrl) {
        baseUrl = toAbsoluteUrl(trackRaw, rootUrl) || toAbsoluteUrl(trackRaw, baseUrl) || baseUrl
      } else {
        baseUrl = toAbsoluteUrl(trackRaw, baseUrl) || baseUrl
      }
    }

    return baseUrl
  }

  function normalizeSegments(segments, baseUrl) {
    return ensureArray(segments).map(function(segment) {
      if (typeof segment === 'string') {
        return toAbsoluteUrl(segment, baseUrl)
      }

      if (!segment || typeof segment !== 'object') return null
      return toAbsoluteUrl(segment.url, baseUrl)
    }).filter(function(url) {
      return Boolean(url)
    })
  }

  function normalizeTrack(track, playlistUrl, playlistBaseUrl) {
    if (!track || typeof track !== 'object') return null

    var baseUrl = buildTrackBaseUrl(playlistUrl, playlistBaseUrl, track.base_url)
    var segments = normalizeSegments(track.segments, baseUrl)

    if (!baseUrl || segments.length === 0) return null

    return {
      baseUrl: baseUrl,
      bitrate: toNumber(track.bitrate),
      codecs: typeof track.codecs === 'string' ? track.codecs : '',
      height: toNumber(track.height),
      id: String(track.id || track.base_url || ''),
      initSegment: typeof track.init_segment === 'string' ? track.init_segment : '',
      mimeType: typeof track.mime_type === 'string' ? track.mime_type : '',
      segments: segments,
      width: toNumber(track.width),
    }
  }

  function sortVideoTracks(left, right) {
    var heightDiff = Number(right && right.height || 0) - Number(left && left.height || 0)
    if (heightDiff !== 0) return heightDiff
    return Number(right && right.bitrate || 0) - Number(left && left.bitrate || 0)
  }

  function sortAudioTracks(left, right) {
    return Number(right && right.bitrate || 0) - Number(left && left.bitrate || 0)
  }

  function buildQuality(track) {
    if (track && track.height) {
      return String(track.height) + 'p'
    }

    return 'Original'
  }

  function buildOptionUrl(playlistUrl, videoTrack, audioTrack) {
    return String(playlistUrl || '') +
      '#video=' + encodeURIComponent(String(videoTrack && videoTrack.id || 'video')) +
      '&audio=' + encodeURIComponent(String(audioTrack && audioTrack.id || 'audio'))
  }

  function buildDownloadOption(playlistUrl, videoTrack, audioTrack) {
    var quality = buildQuality(videoTrack)

    return {
      audioTrack: audioTrack,
      bitrate: videoTrack && videoTrack.bitrate ? videoTrack.bitrate : null,
      height: videoTrack && videoTrack.height ? videoTrack.height : null,
      label: quality + ' (Vimeo)',
      playlistUrl: playlistUrl,
      quality: quality,
      type: 'vimeo-playlist',
      url: buildOptionUrl(playlistUrl, videoTrack, audioTrack),
      videoTrack: videoTrack,
      width: videoTrack && videoTrack.width ? videoTrack.width : null,
    }
  }

  function resolvePlaylistDetails(payload, playlistUrl) {
    var parsed

    try {
      parsed = JSON.parse(payload)
    } catch {
      return null
    }

    if (!parsed || typeof parsed !== 'object') return null

    var playlistBaseUrl = typeof parsed.base_url === 'string' ? parsed.base_url : ''
    var videoTracks = ensureArray(parsed.video)
      .map(function(track) {
        return normalizeTrack(track, playlistUrl, playlistBaseUrl)
      })
      .filter(Boolean)
      .sort(sortVideoTracks)

    if (videoTracks.length === 0) return null

    var audioTracks = ensureArray(parsed.audio)
      .map(function(track) {
        return normalizeTrack(track, playlistUrl, playlistBaseUrl)
      })
      .filter(Boolean)
      .sort(sortAudioTracks)

    var selectedAudioTrack = audioTracks[0] || null
    var options = videoTracks.map(function(videoTrack) {
      return buildDownloadOption(playlistUrl, videoTrack, selectedAudioTrack)
    })

    return {
      options: options,
      selectedType: 'vimeo-playlist',
      selectedUrl: options[0] ? options[0].url : null,
    }
  }

  var api = {
    appendBase64InitParam: appendBase64InitParam,
    buildTrackBaseUrl: buildTrackBaseUrl,
    extractPlaylistRootUrl: extractPlaylistRootUrl,
    resolvePlaylistDetails: resolvePlaylistDetails,
  }

  root.BaixarHSLVimeoPlaylist = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

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

  function parseQualityValue(quality, height) {
    if (quality) {
      var parsed = Number.parseInt(String(quality), 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    return Number(height || 0)
  }

  function buildProgressiveLabel(quality, fps) {
    var prefix = quality || 'MP4'
    if (fps && fps > 30) {
      return prefix + ' ' + fps + 'fps (MP4)'
    }

    return prefix + ' (MP4)'
  }

  function readStringCandidate(record, keys) {
    if (!record || typeof record !== 'object') return null

    for (var i = 0; i < keys.length; i += 1) {
      var value = record[keys[i]]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }

    return null
  }

  function pickBestThumbnailFromThumbs(thumbs, baseUrl) {
    if (!thumbs || typeof thumbs !== 'object') return null

    var bestWidth = -1
    var bestUrl = null
    var entries = Object.entries(thumbs)

    for (var i = 0; i < entries.length; i += 1) {
      var key = entries[i][0]
      var value = entries[i][1]
      if (typeof value !== 'string' || !value.trim()) continue

      var absoluteUrl = toAbsoluteUrl(value, baseUrl)
      if (!absoluteUrl) continue

      var width = Number.parseInt(key, 10)
      if (Number.isNaN(width)) width = 0

      if (width > bestWidth) {
        bestWidth = width
        bestUrl = absoluteUrl
      }
    }

    return bestUrl
  }

  function pickBestThumbnailFromPictures(pictures, baseUrl) {
    if (!pictures || typeof pictures !== 'object') return null

    var directUrl = readStringCandidate(pictures, ['base_link', 'base_link_with_play_button', 'link'])
    if (directUrl) return toAbsoluteUrl(directUrl, baseUrl)

    if (!Array.isArray(pictures.sizes)) return null

    var bestWidth = -1
    var bestUrl = null

    for (var i = 0; i < pictures.sizes.length; i += 1) {
      var size = pictures.sizes[i]
      if (!size || typeof size !== 'object') continue

      var rawUrl = readStringCandidate(size, ['link', 'link_with_play_button'])
      var absoluteUrl = rawUrl ? toAbsoluteUrl(rawUrl, baseUrl) : null
      if (!absoluteUrl) continue

      var width = typeof size.width === 'number' ? size.width : 0
      if (width > bestWidth) {
        bestWidth = width
        bestUrl = absoluteUrl
      }
    }

    return bestUrl
  }

  function extractVimeoMetadata(payload, baseUrl) {
    var parsed

    try {
      parsed = JSON.parse(payload)
    } catch {
      return {
        thumbnailUrl: null,
        title: null,
      }
    }

    var rootRecord = parsed && typeof parsed === 'object' ? parsed : {}
    var video = rootRecord.video && typeof rootRecord.video === 'object' ? rootRecord.video : null
    var clip = rootRecord.clip && typeof rootRecord.clip === 'object' ? rootRecord.clip : null

    var title =
      (video && readStringCandidate(video, ['title', 'name'])) ||
      (clip && readStringCandidate(clip, ['title', 'name'])) ||
      readStringCandidate(rootRecord, ['title', 'name'])

    var thumbnailUrl =
      (video && readStringCandidate(video, ['thumbnail', 'thumbnail_url'])) ||
      readStringCandidate(rootRecord, ['thumbnail_url', 'thumbnail'])

    if (thumbnailUrl) {
      thumbnailUrl = toAbsoluteUrl(thumbnailUrl, baseUrl)
    }

    if (!thumbnailUrl && video && video.thumbs) {
      thumbnailUrl = pickBestThumbnailFromThumbs(video.thumbs, baseUrl)
    }

    if (!thumbnailUrl && video && video.pictures) {
      thumbnailUrl = pickBestThumbnailFromPictures(video.pictures, baseUrl)
    }

    return {
      thumbnailUrl: thumbnailUrl || null,
      title: title || null,
    }
  }

  function extractVimeoDownloadOptions(payload, baseUrl) {
    var parsed

    try {
      parsed = JSON.parse(payload)
    } catch {
      return []
    }

    var progressiveList =
      parsed &&
      parsed.request &&
      parsed.request.files &&
      Array.isArray(parsed.request.files.progressive)
        ? parsed.request.files.progressive
        : null

    if (!progressiveList) return []

    var options = []

    for (var i = 0; i < progressiveList.length; i += 1) {
      var entry = progressiveList[i]
      var rawUrl = typeof entry.url === 'string' ? entry.url : ''
      var absoluteUrl = toAbsoluteUrl(rawUrl, baseUrl)
      if (!absoluteUrl) continue

      var height = typeof entry.height === 'number' ? entry.height : null
      var quality =
        typeof entry.quality === 'string'
          ? entry.quality
          : height
            ? String(height) + 'p'
            : null
      var fps = typeof entry.fps === 'number' ? entry.fps : null

      options.push({
        fps: fps,
        height: height,
        label: buildProgressiveLabel(quality, fps),
        quality: quality,
        type: 'progressive',
        url: absoluteUrl,
        width: typeof entry.width === 'number' ? entry.width : null,
      })
    }

    options.sort(function(left, right) {
      var qualityDiff =
        parseQualityValue(right.quality, right.height) - parseQualityValue(left.quality, left.height)
      if (qualityDiff !== 0) return qualityDiff
      return (right.fps || 0) - (left.fps || 0)
    })

    return options.filter(function(option, index, array) {
      return array.findIndex(function(candidate) {
        return candidate.url === option.url
      }) === index
    })
  }

  function extractAdaptiveUrlFromFiles(parsed, baseUrl, key) {
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.request || typeof parsed.request !== 'object') return null
    if (!parsed.request.files || typeof parsed.request.files !== 'object') return null

    var fileRecord = parsed.request.files[key]
    if (!fileRecord || typeof fileRecord !== 'object') return null

    if (typeof fileRecord.url === 'string' && fileRecord.url.trim()) {
      return toAbsoluteUrl(fileRecord.url, baseUrl)
    }

    var cdns = fileRecord.cdns && typeof fileRecord.cdns === 'object' ? fileRecord.cdns : null
    if (!cdns) return null

    if (typeof fileRecord.default_cdn === 'string' && cdns[fileRecord.default_cdn]) {
      var defaultCdnRecord = cdns[fileRecord.default_cdn]
      if (defaultCdnRecord && typeof defaultCdnRecord.url === 'string' && defaultCdnRecord.url.trim()) {
        return toAbsoluteUrl(defaultCdnRecord.url, baseUrl)
      }
    }

    var cdnEntries = Object.entries(cdns)
    for (var i = 0; i < cdnEntries.length; i += 1) {
      var cdnRecord = cdnEntries[i][1]
      if (!cdnRecord || typeof cdnRecord.url !== 'string' || !cdnRecord.url.trim()) continue
      return toAbsoluteUrl(cdnRecord.url, baseUrl)
    }

    return null
  }

  function isPartialFragmentUrl(url) {
    var lower = String(url || '').toLowerCase()
    return (
      lower.includes('/range/') ||
      lower.includes('/segment/') ||
      lower.includes('.m4s') ||
      /[?&]range=/.test(lower)
    )
  }

  function hasDrmFlag(filesSection, key) {
    if (!filesSection || !filesSection[key]) return false
    var section = filesSection[key]
    if (section.drm === true) return true
    var cdns = section.cdns && typeof section.cdns === 'object' ? section.cdns : {}
    var cdnKeys = Object.keys(cdns)
    for (var i = 0; i < cdnKeys.length; i++) {
      var cdn = cdns[cdnKeys[i]]
      if (cdn && cdn.drm === true) return true
    }
    return false
  }

  function resolveVimeoStreamDetails(payload, baseUrl) {
    var parsed = null
    try {
      parsed = JSON.parse(payload)
    } catch (error) {
      void error
    }

    var metadata = extractVimeoMetadata(payload, baseUrl)

    // Check for DRM before anything else
    var files = parsed && parsed.request && parsed.request.files ? parsed.request.files : null
    var isDrmProtected = Boolean(
      files && (hasDrmFlag(files, 'hls') || hasDrmFlag(files, 'dash')) &&
      !files.progressive
    )

    if (isDrmProtected) {
      return {
        blockReason: 'Conteudo protegido por DRM. A extensao nao pode baixar esse stream.',
        canDownloadDash: false,
        canDownloadDirect: false,
        canDownloadHls: false,
        canDownloadVimeoPlaylist: false,
        isDrmProtected: true,
        options: [],
        selectedType: 'drm',
        selectedUrl: null,
        thumbnailUrl: metadata.thumbnailUrl,
        title: metadata.title,
      }
    }

    // Progressive options — filter out adaptive range fragments
    var allOptions = extractVimeoDownloadOptions(payload, baseUrl)
    var options = allOptions.filter(function(opt) {
      return !isPartialFragmentUrl(opt.url)
    })

    var selected = options[0] || null
    var selectedUrl = selected ? selected.url : null
    var selectedType = selected ? selected.type : null

    if (!selectedUrl) {
      var hlsUrl = extractAdaptiveUrlFromFiles(parsed, baseUrl, 'hls')
      if (hlsUrl) {
        selectedUrl = hlsUrl
        selectedType = 'hls'
      }
    }

    if (!selectedUrl) {
      var dashUrl = extractAdaptiveUrlFromFiles(parsed, baseUrl, 'dash')
      if (dashUrl) {
        selectedUrl = dashUrl
        selectedType = 'dash'
      }
    }

    // Check embed.adaptive_url for Vimeo segmented playlist
    if (!selectedUrl && parsed && parsed.embed && typeof parsed.embed.adaptive_url === 'string') {
      var adaptiveUrl = toAbsoluteUrl(parsed.embed.adaptive_url, baseUrl)
      if (adaptiveUrl) {
        selectedUrl = adaptiveUrl
        selectedType = 'vimeo'
      }
    }

    if (!selectedUrl && root.BaixarHSLDetector && typeof root.BaixarHSLDetector.extractStreamMatchesFromText === 'function') {
      var matches = root.BaixarHSLDetector.extractStreamMatchesFromText(payload, baseUrl)

      for (var i = 0; i < matches.length; i += 1) {
        var directMatch = matches[i]
        if (!directMatch || directMatch.type === 'vimeo') continue
        selectedUrl = directMatch.url
        selectedType = directMatch.type
        break
      }

      if (!selectedUrl) {
        for (var j = 0; j < matches.length; j += 1) {
          var nestedVimeoMatch = matches[j]
          if (!nestedVimeoMatch || nestedVimeoMatch.type !== 'vimeo') continue
          selectedUrl = nestedVimeoMatch.url
          selectedType = nestedVimeoMatch.type
          break
        }
      }
    }

    var canDownloadDirect = selectedType === 'progressive' && options.length > 0
    var canDownloadHls = selectedType === 'hls'
    var canDownloadDash = selectedType === 'dash'
    var canDownloadVimeoPlaylist = selectedType === 'vimeo'

    return {
      canDownloadDash: canDownloadDash,
      canDownloadDirect: canDownloadDirect,
      canDownloadHls: canDownloadHls,
      canDownloadVimeoPlaylist: canDownloadVimeoPlaylist,
      isDrmProtected: false,
      options: canDownloadDirect ? options : [],
      selectedType: selectedType,
      selectedUrl: selectedUrl,
      thumbnailUrl: metadata.thumbnailUrl,
      title: metadata.title,
    }
  }

  var api = {
    extractVimeoDownloadOptions: extractVimeoDownloadOptions,
    extractVimeoMetadata: extractVimeoMetadata,
    resolveVimeoStreamDetails: resolveVimeoStreamDetails,
  }

  root.BaixarHSLStreamDetails = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

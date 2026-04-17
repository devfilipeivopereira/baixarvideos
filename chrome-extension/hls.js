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

  function splitAttributeList(text) {
    var source = String(text || '')
    var parts = []
    var current = ''
    var inQuotes = false

    for (var i = 0; i < source.length; i += 1) {
      var char = source[i]

      if (char === '"') {
        inQuotes = !inQuotes
        current += char
        continue
      }

      if (char === ',' && !inQuotes) {
        if (current.trim()) parts.push(current.trim())
        current = ''
        continue
      }

      current += char
    }

    if (current.trim()) parts.push(current.trim())
    return parts
  }

  function parseAttributeList(text) {
    var attributes = {}
    var pairs = splitAttributeList(text)

    for (var i = 0; i < pairs.length; i += 1) {
      var pair = pairs[i]
      var separatorIndex = pair.indexOf('=')
      if (separatorIndex <= 0) continue

      var key = pair.slice(0, separatorIndex).trim()
      var rawValue = pair.slice(separatorIndex + 1).trim()
      if (!key) continue

      if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        rawValue = rawValue.slice(1, -1)
      }

      attributes[key] = rawValue
    }

    return attributes
  }

  function inferResolution(attributes) {
    if (!attributes || typeof attributes.RESOLUTION !== 'string') {
      return { height: null, width: null }
    }

    var parts = attributes.RESOLUTION.toLowerCase().split('x')
    if (parts.length !== 2) {
      return { height: null, width: null }
    }

    var width = Number.parseInt(parts[0], 10)
    var height = Number.parseInt(parts[1], 10)

    return {
      height: Number.isNaN(height) ? null : height,
      width: Number.isNaN(width) ? null : width,
    }
  }

  function buildQualityLabel(attributes, resolution) {
    if (resolution.height) {
      return String(resolution.height) + 'p'
    }

    if (attributes && typeof attributes.NAME === 'string' && attributes.NAME.trim()) {
      return attributes.NAME.trim()
    }

    return 'Original'
  }

  function buildVariantOption(attributes, variantUrl) {
    var resolution = inferResolution(attributes)
    var quality = buildQualityLabel(attributes, resolution)
    var bandwidth = Number.parseInt(String(attributes && attributes.BANDWIDTH || ''), 10)

    return {
      bandwidth: Number.isNaN(bandwidth) ? null : bandwidth,
      height: resolution.height,
      label: quality + ' (HLS)',
      quality: quality,
      type: 'hls',
      url: variantUrl,
      width: resolution.width,
    }
  }

  function parseManifest(manifestText, manifestUrl) {
    var lines = String(manifestText || '')
      .split(/\r?\n/)
      .map(function(line) {
        return line.trim()
      })
      .filter(function(line) {
        return line.length > 0
      })

    var variants = []
    var segments = []

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index]

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        var attributes = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length))
        var nextLine = lines[index + 1] || ''
        var variantUrl = toAbsoluteUrl(nextLine, manifestUrl)

        if (variantUrl) {
          variants.push(buildVariantOption(attributes, variantUrl))
        }

        index += 1
        continue
      }

      if (line.startsWith('#')) continue

      var segmentUrl = toAbsoluteUrl(line, manifestUrl)
      if (segmentUrl) {
        segments.push(segmentUrl)
      }
    }

    if (variants.length > 0) {
      variants.sort(function(left, right) {
        var heightDiff = (right.height || 0) - (left.height || 0)
        if (heightDiff !== 0) return heightDiff
        return (right.bandwidth || 0) - (left.bandwidth || 0)
      })
    }

    return {
      kind: variants.length > 0 ? 'master' : 'media',
      segments: variants.length > 0 ? [] : segments,
      variants: variants,
    }
  }

  function inferFileExtension(url, fallbackExtension) {
    var safeFallback = fallbackExtension || '.bin'

    try {
      var pathname = new URL(url).pathname
      var match = pathname.match(/(\.[a-z0-9]{1,5})$/i)
      return match ? match[1].toLowerCase() : safeFallback
    } catch {
      return safeFallback
    }
  }

  function replaceUriAttribute(line, newValue) {
    return String(line).replace(/URI=("[^"]*"|[^,]*)/, 'URI="' + newValue + '"')
  }

  function buildSegmentFilename(index, url) {
    return 'seg' + String(index).padStart(5, '0') + inferFileExtension(url, '.ts')
  }

  function buildMapFilename(index, url) {
    return 'map' + String(index).padStart(3, '0') + inferFileExtension(url, '.mp4')
  }

  function buildKeyFilename(index, url) {
    return 'key' + String(index).padStart(3, '0') + inferFileExtension(url, '.key')
  }

  function extractMediaEntries(manifestText, manifestUrl) {
    var lines = String(manifestText || '').split(/\r?\n/)
    var rewrittenLines = []
    var resources = []
    var keyCount = 0
    var mapCount = 0
    var segmentCount = 0

    for (var index = 0; index < lines.length; index += 1) {
      var rawLine = lines[index]
      var trimmed = rawLine.trim()

      if (!trimmed) {
        rewrittenLines.push('')
        continue
      }

      if (trimmed.startsWith('#EXT-X-KEY:')) {
        var keyAttributes = parseAttributeList(trimmed.slice('#EXT-X-KEY:'.length))
        var keyUrl = toAbsoluteUrl(keyAttributes.URI, manifestUrl)

        if (!keyUrl) {
          rewrittenLines.push(trimmed)
          continue
        }

        var keyFilename = buildKeyFilename(keyCount, keyUrl)
        keyCount += 1
        resources.push({ filename: keyFilename, kind: 'key', url: keyUrl })
        rewrittenLines.push(replaceUriAttribute(trimmed, keyFilename))
        continue
      }

      if (trimmed.startsWith('#EXT-X-MAP:')) {
        var mapAttributes = parseAttributeList(trimmed.slice('#EXT-X-MAP:'.length))
        var mapUrl = toAbsoluteUrl(mapAttributes.URI, manifestUrl)

        if (!mapUrl) {
          rewrittenLines.push(trimmed)
          continue
        }

        var mapFilename = buildMapFilename(mapCount, mapUrl)
        mapCount += 1
        resources.push({ filename: mapFilename, kind: 'map', url: mapUrl })
        rewrittenLines.push(replaceUriAttribute(trimmed, mapFilename))
        continue
      }

      if (trimmed.startsWith('#')) {
        rewrittenLines.push(trimmed)
        continue
      }

      var segmentUrl = toAbsoluteUrl(trimmed, manifestUrl)
      if (!segmentUrl) {
        rewrittenLines.push(trimmed)
        continue
      }

      var segmentFilename = buildSegmentFilename(segmentCount, segmentUrl)
      segmentCount += 1
      resources.push({ filename: segmentFilename, kind: 'segment', url: segmentUrl })
      rewrittenLines.push(segmentFilename)
    }

    return {
      playlistText: rewrittenLines.join('\n'),
      resources: resources,
    }
  }

  function resolvePlaylist(manifestText, manifestUrl) {
    return parseManifest(manifestText, manifestUrl)
  }

  var api = {
    buildKeyFilename: buildKeyFilename,
    buildMapFilename: buildMapFilename,
    buildSegmentFilename: buildSegmentFilename,
    extractMediaEntries: extractMediaEntries,
    inferFileExtension: inferFileExtension,
    parseAttributeList: parseAttributeList,
    parseManifest: parseManifest,
    resolvePlaylist: resolvePlaylist,
    toAbsoluteUrl: toAbsoluteUrl,
  }

  root.BaixarHSLHls = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

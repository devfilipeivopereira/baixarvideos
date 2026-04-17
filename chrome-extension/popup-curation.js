;(function(root) {
  function normalizeText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  function parseResolutionValue(value) {
    if (typeof value === 'number' && !Number.isNaN(value)) return value

    var match = String(value || '').match(/(\d{3,4})/)
    if (!match) return 0

    var parsed = Number.parseInt(match[1], 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  function getOptionHeight(option) {
    if (!option || typeof option !== 'object') return 0
    if (typeof option.height === 'number' && !Number.isNaN(option.height)) return option.height
    return parseResolutionValue(option.quality || option.label || '')
  }

  function getMaxResolutionHeight(details) {
    if (!details || !Array.isArray(details.options)) return 0

    var maxHeight = 0
    for (var i = 0; i < details.options.length; i += 1) {
      maxHeight = Math.max(maxHeight, getOptionHeight(details.options[i]))
    }

    return maxHeight
  }

  function getResolutionLabel(details) {
    var maxHeight = getMaxResolutionHeight(details)
    if (maxHeight > 0) return String(maxHeight) + 'p'
    return 'Original'
  }

  function getDownloadMode(details) {
    if (!details || typeof details !== 'object') return ''
    if (details.canDownloadDirect) return 'direct'
    if (details.canDownloadVimeoPlaylist) return 'vimeo-playlist'
    if (details.canDownloadHls) return 'hls'
    if (details.canDownloadDash) return 'dash'
    return ''
  }

  function getModeLabel(mode) {
    if (mode === 'direct') return 'MP4 Direto'
    if (mode === 'vimeo-playlist') return 'Vimeo Segmentado'
    if (mode === 'hls') return 'HLS'
    if (mode === 'dash') return 'DASH'
    return 'Indisponivel'
  }

  function getModePriority(mode) {
    if (mode === 'direct') return 3
    if (mode === 'vimeo-playlist') return 2
    if (mode === 'hls') return 1
    if (mode === 'dash') return 1
    return 0
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

  function hasRealDownloadableOptions(details) {
    if (!details || !Array.isArray(details.options) || details.options.length === 0) return false
    return details.options.some(function(opt) {
      return opt && opt.url && !isPartialFragmentUrl(opt.url)
    })
  }

  function isDownloadable(details) {
    if (!getDownloadMode(details)) return false
    // If all options are partial adaptive fragment URLs, this entry is not downloadable
    if (details.canDownloadDirect && !hasRealDownloadableOptions(details)) return false
    return true
  }

  function buildOptionsFingerprint(details) {
    if (!details || !Array.isArray(details.options) || details.options.length === 0) return ''

    return details.options
      .map(function(option) {
        return [
          String(option && option.type || ''),
          String(getOptionHeight(option)),
          String(option && option.url || ''),
        ].join(':')
      })
      .sort()
      .join('|')
  }

  function buildEntry(item) {
    if (!item || !item.stream || !item.details || !isDownloadable(item.details)) return null

    var mode = getDownloadMode(item.details)
    var resolutionHeight = getMaxResolutionHeight(item.details)
    var title = String(item.details.title || item.stream.title || 'Video detectado')
    var thumbnailUrl = String(item.details.thumbnailUrl || item.stream.thumbnailUrl || '')
    var normalizedTitle = normalizeText(title)
    var normalizedThumbnail = normalizeText(thumbnailUrl)
    var optionsFingerprint = buildOptionsFingerprint(item.details)

    return {
      dedupeKey: normalizedThumbnail || normalizedTitle
        ? [normalizedTitle, normalizedThumbnail].join('::')
        : [normalizedTitle, optionsFingerprint, String(item.details.selectedUrl || '')].join('::'),
      details: item.details,
      mode: mode,
      modeLabel: getModeLabel(mode),
      optionCount: Array.isArray(item.details.options) ? item.details.options.length : 0,
      resolutionHeight: resolutionHeight,
      resolutionLabel: getResolutionLabel(item.details),
      stream: item.stream,
      thumbnailUrl: thumbnailUrl,
      timestamp: Number(item.stream.timestamp || 0),
      title: title,
    }
  }

  function choosePreferredEntry(currentEntry, nextEntry) {
    if (!currentEntry) return nextEntry
    if (!nextEntry) return currentEntry

    var currentModePriority = getModePriority(currentEntry.mode)
    var nextModePriority = getModePriority(nextEntry.mode)
    if (nextModePriority !== currentModePriority) {
      return nextModePriority > currentModePriority ? nextEntry : currentEntry
    }

    if (nextEntry.resolutionHeight !== currentEntry.resolutionHeight) {
      return nextEntry.resolutionHeight > currentEntry.resolutionHeight ? nextEntry : currentEntry
    }

    if (nextEntry.optionCount !== currentEntry.optionCount) {
      return nextEntry.optionCount > currentEntry.optionCount ? nextEntry : currentEntry
    }

    return nextEntry.timestamp >= currentEntry.timestamp ? nextEntry : currentEntry
  }

  function sortEntries(left, right) {
    var modePriorityDiff = getModePriority(right.mode) - getModePriority(left.mode)
    if (modePriorityDiff !== 0) return modePriorityDiff

    var resolutionDiff = right.resolutionHeight - left.resolutionHeight
    if (resolutionDiff !== 0) return resolutionDiff

    var optionDiff = right.optionCount - left.optionCount
    if (optionDiff !== 0) return optionDiff

    return right.timestamp - left.timestamp
  }

  function curateResolvedItems(items) {
    var entryByKey = new Map()
    var input = Array.isArray(items) ? items : []

    for (var i = 0; i < input.length; i += 1) {
      var entry = buildEntry(input[i])
      if (!entry) continue

      var currentEntry = entryByKey.get(entry.dedupeKey)
      entryByKey.set(entry.dedupeKey, choosePreferredEntry(currentEntry, entry))
    }

    return Array.from(entryByKey.values()).sort(sortEntries)
  }

  var api = {
    curateResolvedItems: curateResolvedItems,
    getDownloadMode: getDownloadMode,
    getMaxResolutionHeight: getMaxResolutionHeight,
    getResolutionLabel: getResolutionLabel,
  }

  root.BaixarHSLPopupCuration = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

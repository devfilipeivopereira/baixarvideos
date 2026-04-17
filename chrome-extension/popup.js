var currentStreams = []
var currentResolvedItems = []
var currentDiagnostics = null
var currentDebugReport = ''
var currentResolvedDetails = null
var currentResolvedKey = ''
var currentSelectedUrl = ''
var currentStream = null
var currentTab = null
var backgroundResponsive = false
var debugOpen = false
var currentListBusy = false
var currentResolveToken = 0
var currentActionMessage = ''
var currentActionBusy = false
var downloadsApiAvailable = Boolean(chrome.downloads && chrome.downloads.download)
var hlsDownloadApi = globalThis.BaixarHSLHlsDownload
var popupCurationApi = globalThis.BaixarHSLPopupCuration
var streamSelectionApi = globalThis.BaixarHSLStreamSelection

function sanitizeFilenamePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferUrlExtension(url) {
  var lower = String(url || '').toLowerCase()
  if (lower.includes('.m3u8')) return '.mp4'
  if (lower.includes('.mpd')) return '.mp4'
  if (lower.includes('playlist.json')) return '.mp4'
  if (lower.includes('master.json')) return '.mp4'
  if (lower.includes('#video=')) return '.mp4'
  var extensionMatch = lower.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)
  if (extensionMatch) return '.' + extensionMatch[1]
  return '.mp4'
}

function buildDownloadFilename(title, option, url) {
  var safeTitle = sanitizeFilenamePart(title || 'video')
  var safeQuality = sanitizeFilenamePart(option && option.quality ? option.quality : '')
  var suffix = safeQuality ? ' - ' + safeQuality : ''
  return safeTitle + suffix + inferUrlExtension(url)
}

function isPartialMediaFragmentUrl(url) {
  if (streamSelectionApi && typeof streamSelectionApi.isPartialMediaFragmentUrl === 'function') {
    return streamSelectionApi.isPartialMediaFragmentUrl(url)
  }

  var lower = String(url || '').toLowerCase()
  return (
    lower.includes('/range/') ||
    lower.includes('/segment/') ||
    lower.includes('.m4s') ||
    /[?&]range=/.test(lower)
  )
}

function timeAgo(ts) {
  var seconds = Math.floor((Date.now() - Number(ts || 0)) / 1000)
  if (seconds < 60) return seconds + 's atras'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'min atras'
  return Math.floor(seconds / 3600) + 'h atras'
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function badge(label, ok) {
  var bg = ok ? '#dcfce7' : '#fee2e2'
  var fg = ok ? '#166534' : '#991b1b'
  return '<span style="display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:' + bg + ';color:' + fg + ';font-size:10px;font-weight:600">' + escapeHtml(label) + '</span>'
}

function sendRuntimeMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, function(response) {
      var error = chrome.runtime.lastError
      callback(error || null, response || null)
    })
  } catch (error) {
    callback(error, null)
  }
}

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    callback(tabs && tabs[0] ? tabs[0] : null)
  })
}

function getScopedStreams() {
  if (!currentTab || typeof currentTab.id !== 'number') return currentStreams

  var sameTab = currentStreams.filter(function(stream) {
    return typeof stream.tabId === 'number' && stream.tabId === currentTab.id
  })

  var visibleStreams = sameTab.length > 0 ? sameTab : currentStreams
  var filteredStreams = visibleStreams.filter(function(stream) {
    return !isPartialMediaFragmentUrl(stream && stream.url)
  })
  if (filteredStreams.length > 0) {
    visibleStreams = filteredStreams
  }

  if (!streamSelectionApi || typeof streamSelectionApi.sortStreamsForSelection !== 'function') {
    return visibleStreams
  }

  return streamSelectionApi.sortStreamsForSelection(visibleStreams)
}

function getResolvedItems() {
  return Array.isArray(currentResolvedItems) ? currentResolvedItems : []
}

function getListEmptyStateText() {
  if (currentListBusy) {
    return 'Analisando videos baixaveis nesta aba...'
  }

  if (currentStreams.length > 0) {
    return 'Nenhum video baixavel encontrado nesta aba. Veja o Debug para diagnostico.'
  }

  return 'Nenhum stream capturado nesta aba ainda.'
}

function applyResolvedItem(item) {
  if (!item) {
    currentResolvedDetails = null
    currentResolvedKey = ''
    currentSelectedUrl = ''
    currentStream = null
    return
  }

  currentResolvedDetails = item.details
  currentResolvedKey = item.dedupeKey || ''
  currentSelectedUrl = item.details && item.details.selectedUrl
    ? item.details.selectedUrl
    : item.details && Array.isArray(item.details.options) && item.details.options[0]
      ? item.details.options[0].url
      : ''
  currentStream = item.stream
}

function syncSelectedResolvedItem(items) {
  var resolvedItems = Array.isArray(items) ? items : []

  if (resolvedItems.length === 0) {
    applyResolvedItem(null)
    return
  }

  var selectedItem = null

  if (currentResolvedKey) {
    for (var i = 0; i < resolvedItems.length; i++) {
      if (resolvedItems[i] && resolvedItems[i].dedupeKey === currentResolvedKey) {
        selectedItem = resolvedItems[i]
        break
      }
    }
  }

  if (!selectedItem && currentStream) {
    for (var j = 0; j < resolvedItems.length; j++) {
      var candidate = resolvedItems[j]
      if (
        candidate &&
        candidate.stream &&
        candidate.stream.url === currentStream.url &&
        candidate.stream.type === currentStream.type
      ) {
        selectedItem = candidate
        break
      }
    }
  }

  applyResolvedItem(selectedItem || resolvedItems[0])
}

function resolveStreamDetailsAsync(stream) {
  return new Promise(function(resolve) {
    sendRuntimeMessage({
      action: 'resolveStreamDetails',
      stream: stream,
    }, function(error, response) {
      if (error || !response || !response.ok || !response.details) {
        resolve(null)
        return
      }

      resolve(response.details)
    })
  })
}

async function refreshResolvedItems() {
  var token = ++currentResolveToken
  var scopedStreams = getScopedStreams()

  currentResolvedItems = []
  currentListBusy = scopedStreams.length > 0
  applyResolvedItem(null)
  clearActionState()
  renderStreams()

  if (scopedStreams.length === 0) {
    currentListBusy = false
    renderStreams()
    return
  }

  var resolvedCandidates = await Promise.all(scopedStreams.map(async function(stream) {
    var details = await resolveStreamDetailsAsync(stream)
    return {
      details: details,
      stream: stream,
    }
  }))

  if (token !== currentResolveToken) {
    return
  }

  if (popupCurationApi && typeof popupCurationApi.curateResolvedItems === 'function') {
    currentResolvedItems = popupCurationApi.curateResolvedItems(resolvedCandidates)
  } else {
    currentResolvedItems = resolvedCandidates
      .filter(function(candidate) {
        return Boolean(candidate && candidate.details)
      })
      .map(function(candidate) {
        return {
          dedupeKey: String(candidate.stream.url || ''),
          details: candidate.details,
          mode: '',
          modeLabel: '',
          resolutionLabel: 'Original',
          stream: candidate.stream,
          timestamp: Number(candidate.stream.timestamp || 0),
          title: candidate.details.title || candidate.stream.title || 'Video detectado',
        }
      })
  }

  currentListBusy = false
  syncSelectedResolvedItem(currentResolvedItems)
  renderStreams()
}

function getSelectedOption() {
  if (!currentResolvedDetails) return null
  if (!Array.isArray(currentResolvedDetails.options) || currentResolvedDetails.options.length === 0) return null

  for (var i = 0; i < currentResolvedDetails.options.length; i++) {
    var option = currentResolvedDetails.options[i]
    if (option && option.url === currentSelectedUrl) {
      return option
    }
  }

  return currentResolvedDetails.options[0]
}

function getEffectiveDownloadUrl() {
  var option = getSelectedOption()
  if (option && option.url) return option.url

  if (currentResolvedDetails && currentResolvedDetails.selectedUrl) {
    return currentResolvedDetails.selectedUrl
  }

  return currentStream ? currentStream.url : ''
}

function getEffectiveTitle() {
  if (currentResolvedDetails && currentResolvedDetails.title) return currentResolvedDetails.title
  if (currentStream && currentStream.title) return currentStream.title
  return 'Video detectado'
}

function getEffectiveThumbnail() {
  if (currentResolvedDetails && currentResolvedDetails.thumbnailUrl) return currentResolvedDetails.thumbnailUrl
  if (currentStream && currentStream.thumbnailUrl) return currentStream.thumbnailUrl
  return ''
}

function getEffectiveType() {
  if (currentResolvedDetails && currentResolvedDetails.selectedType) return currentResolvedDetails.selectedType
  if (currentStream && currentStream.type) return currentStream.type
  return ''
}

function setActionState(message, busy) {
  currentActionMessage = message ? String(message) : ''
  currentActionBusy = Boolean(busy)
  renderPreview()
}

function clearActionState() {
  currentActionMessage = ''
  currentActionBusy = false
  renderPreview()
}

function buildStatusText() {
  if (currentActionMessage) {
    return currentActionMessage
  }

  if (!currentStream) {
    if (currentListBusy) {
      return 'Analisando videos baixaveis desta aba...'
    }

    if (currentStreams.length > 0) {
      return 'Nenhum video baixavel encontrado nesta aba. Veja o Debug para diagnostico.'
    }

    return 'Navegue ate a pagina com o video e clique em Atualizar.'
  }

  if (!currentResolvedDetails) {
    return 'Carregando detalhes do stream e opcoes de resolucao...'
  }

  if (currentResolvedDetails.isDrmProtected) {
    return currentResolvedDetails.blockReason || 'Conteudo protegido por DRM. O player foi detectado, mas a extensao nao pode baixar esse stream.'
  }

  if (currentResolvedDetails.blockReason) {
    return currentResolvedDetails.blockReason
  }

  if (currentResolvedDetails.canDownloadDirect) {
    return 'Escolha a resolucao e clique em Baixar no PC.'
  }

  if (currentResolvedDetails.canDownloadHls) {
    return 'Escolha a resolucao e clique em Baixar no PC. A extensao vai converter o stream para MP4.'
  }

  if (currentResolvedDetails.canDownloadVimeoPlaylist) {
    return 'Escolha a resolucao e clique em Baixar no PC. A extensao vai juntar video e audio do Vimeo e salvar em MP4.'
  }

  if (currentResolvedDetails.canDownloadDash) {
    return 'Escolha a resolucao e clique em Baixar no PC. A extensao vai baixar e converter o stream DASH para MP4.'
  }

  var type = getEffectiveType()
  if (type === 'hls') {
    return 'Este stream foi detectado como HLS, mas ainda faltam segmentos ou manifesto validos para converter o stream para MP4.'
  }

  if (type === 'vimeo-playlist') {
    return 'Este Vimeo foi detectado como playlist segmentada, mas a extensao ainda nao conseguiu montar trilhas validas de video e audio.'
  }

  if (type === 'dash') {
    return 'Este stream DASH foi detectado. Clique em Baixar no PC para converter para MP4.'
  }

  if (type === 'drm') {
    return 'Conteudo protegido por DRM. A extensao consegue identificar a protecao, mas nao pode baixar esse stream.'
  }

  if (type === 'media-source') {
    return 'Player com MediaSource detectado. A extensao esta monitorando o fluxo real para tentar encontrar um formato baixavel.'
  }

  return 'Nao foi encontrada uma opcao MP4 direta para este video.'
}

function renderPreview() {
  var image = document.getElementById('previewImage')
  var fallback = document.getElementById('previewFallback')
  var title = document.getElementById('previewTitle')
  var status = document.getElementById('status')
  var type = document.getElementById('previewType')
  var select = document.getElementById('qualitySelect')
  var primaryButton = document.getElementById('btnPrimaryAction')
  var copyButton = document.getElementById('btnCopyUrl')

  var thumbnail = getEffectiveThumbnail()
  if (thumbnail) {
    image.src = thumbnail
    image.style.display = 'block'
    fallback.style.display = 'none'
  } else {
    image.removeAttribute('src')
    image.style.display = 'none'
    fallback.style.display = 'flex'
  }

  title.textContent = currentStream
    ? getEffectiveTitle()
    : currentListBusy
      ? 'Analisando videos baixaveis'
      : currentStreams.length > 0
        ? 'Nenhum video baixavel encontrado'
        : 'Nenhum video selecionado'
  status.textContent = buildStatusText()

  var typeLabel = getEffectiveType()
  type.textContent = currentListBusy
    ? 'ANALISANDO'
    : typeLabel
      ? String(typeLabel).toUpperCase()
      : 'Sem stream'
  type.style.background =
    typeLabel === 'progressive'
      ? '#dcfce7'
      : typeLabel === 'vimeo'
        ? '#dbeafe'
        : typeLabel === 'drm'
          ? '#fee2e2'
          : '#f3f4f6'
  type.style.color =
    typeLabel === 'progressive'
      ? '#166534'
      : typeLabel === 'vimeo'
        ? '#1d4ed8'
        : typeLabel === 'drm'
          ? '#991b1b'
          : '#4b5563'

  select.innerHTML = ''
  var options = currentResolvedDetails && Array.isArray(currentResolvedDetails.options)
    ? currentResolvedDetails.options
    : []

  if (options.length === 0) {
    var emptyOption = document.createElement('option')
    emptyOption.value = ''
    emptyOption.textContent = currentResolvedDetails
      ? 'Sem opcoes MP4 diretas'
      : 'Carregando opcoes'
    select.appendChild(emptyOption)
    select.disabled = true
  } else {
    for (var i = 0; i < options.length; i++) {
      var option = options[i]
      var optionElement = document.createElement('option')
      optionElement.value = option.url
      optionElement.textContent = option.label
      select.appendChild(optionElement)
    }

    if (!currentSelectedUrl) {
      currentSelectedUrl = currentResolvedDetails.selectedUrl || options[0].url
    }

    select.value = currentSelectedUrl
    select.disabled = false
  }

  var canDownloadDirect = Boolean(
    currentStream &&
    currentResolvedDetails &&
    currentResolvedDetails.canDownloadDirect &&
    downloadsApiAvailable &&
    getEffectiveDownloadUrl() &&
    !isPartialMediaFragmentUrl(getEffectiveDownloadUrl())
  )
  var canDownloadHls = Boolean(
    currentStream &&
    currentResolvedDetails &&
    currentResolvedDetails.canDownloadHls &&
    downloadsApiAvailable &&
    getEffectiveDownloadUrl()
  )
  var canDownloadVimeoPlaylist = Boolean(
    currentStream &&
    currentResolvedDetails &&
    currentResolvedDetails.canDownloadVimeoPlaylist &&
    downloadsApiAvailable &&
    getEffectiveDownloadUrl()
  )
  var canDownloadDash = Boolean(
    currentStream &&
    currentResolvedDetails &&
    currentResolvedDetails.canDownloadDash &&
    downloadsApiAvailable &&
    getEffectiveDownloadUrl()
  )
  var canDownload = canDownloadDirect || canDownloadHls || canDownloadVimeoPlaylist || canDownloadDash

  primaryButton.disabled = !canDownload || currentActionBusy
  primaryButton.textContent = currentActionBusy
    ? 'Processando...'
    : canDownload
      ? 'Baixar no PC'
      : 'Download indisponivel'
  primaryButton.style.opacity = canDownload && !currentActionBusy ? '1' : '.55'
  primaryButton.style.cursor = canDownload && !currentActionBusy ? 'pointer' : 'not-allowed'

  copyButton.disabled = !currentStream || currentActionBusy
  copyButton.style.opacity = currentStream && !currentActionBusy ? '1' : '.55'
  select.disabled = select.disabled || currentActionBusy
}

function renderStreams() {
  var list = document.getElementById('list')
  var resolvedItems = getResolvedItems()

  if (resolvedItems.length === 0) {
    list.innerHTML = '<div style="padding:12px;border:1px dashed #d1d5db;border-radius:14px;background:white;color:#6b7280;font-size:12px;text-align:center">' + escapeHtml(getListEmptyStateText()) + '</div>'
    renderPreview()
    return
  }

  list.innerHTML = resolvedItems.slice(0, 5).map(function(item, index) {
    var isActive = currentResolvedKey && item.dedupeKey === currentResolvedKey
    return '<button data-action="select-stream" data-index="' + index + '" style="text-align:left;padding:10px 12px;border:' + (isActive ? '1px solid #16a34a' : '1px solid #e5e7eb') + ';border-radius:14px;background:' + (isActive ? '#f0fdf4' : 'white') + ';cursor:pointer">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
        '<div style="font-size:12px;font-weight:700;color:#111827;line-height:1.35">' + escapeHtml(item.title || 'Video detectado') + '</div>' +
        '<div style="font-size:10px;font-weight:700;color:#166534;white-space:nowrap">' + escapeHtml(item.resolutionLabel || 'Original') + '</div>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:10px;color:#4b5563">' + escapeHtml(item.modeLabel || 'Baixavel') + '</div>' +
      '<div style="margin-top:5px;font-size:10px;color:#9ca3af">' + timeAgo(item.timestamp) + '</div>' +
    '</button>'
  }).join('')

  renderPreview()
}

function renderDebug() {
  var panel = document.getElementById('debugPanel')
  var summary = document.getElementById('debugSummary')
  var badges = document.getElementById('debugBadges')
  var counters = document.getElementById('debugCounters')
  var last = document.getElementById('debugLast')
  var events = document.getElementById('debugEvents')

  panel.style.display = debugOpen ? 'block' : 'none'
  if (!debugOpen) return

  if (!currentTab) {
    summary.textContent = 'Nenhuma aba ativa detectada.'
    badges.innerHTML = ''
    counters.innerHTML = ''
    last.innerHTML = ''
    events.innerHTML = ''
    return
  }

  var state = currentDiagnostics || {
    counts: { requestsSeen: 0, responsesSeen: 0, streamsFound: 0, errors: 0, messagesSeen: 0 },
    events: [],
  }

  summary.textContent = currentTab.title || currentTab.url || 'Aba atual'
  badges.innerHTML = [
    badge('Background', backgroundResponsive),
    badge('Content', Boolean(state.contentScriptSeen)),
    badge('Interceptor', Boolean(state.interceptorSeen)),
  ].join('')

  var counts = state.counts || {}
  counters.innerHTML =
    'Requests relevantes: <b>' + String(counts.requestsSeen || 0) + '</b><br>' +
    'Responses relevantes: <b>' + String(counts.responsesSeen || 0) + '</b><br>' +
    'Streams encontrados: <b>' + String(counts.streamsFound || 0) + '</b><br>' +
    'Mensagens: <b>' + String(counts.messagesSeen || 0) + '</b><br>' +
    'Erros: <b>' + String(counts.errors || 0) + '</b>'

  last.innerHTML =
    'Ultimo request: <span style="font-family:monospace">' + escapeHtml(state.lastRequestUrl || '(nenhum)') + '</span><br>' +
    'Ultima response: <span style="font-family:monospace">' + escapeHtml(state.lastResponseUrl || '(nenhuma)') + '</span><br>' +
    'Ultimo manifesto: <span style="font-family:monospace">' + escapeHtml(state.lastManifestUrl || '(nenhum)') + '</span>' +
    (state.lastManifestType ? ' <b>(' + escapeHtml(state.lastManifestType) + ')</b>' : '') + '<br>' +
    'Ultimo erro: <span style="font-family:monospace">' + escapeHtml(state.lastError || '(nenhum)') + '</span>'

  if (!state.events || state.events.length === 0) {
    events.innerHTML = '<div style="color:#6b7280">Sem eventos de debug para esta aba ainda.</div>'
    return
  }

  events.innerHTML = state.events.slice().reverse().map(function(event) {
    var pieces = [
      '<b>' + escapeHtml(event.source + ':' + event.kind) + '</b>',
      escapeHtml(new Date(event.ts).toLocaleTimeString()),
    ]

    if (event.url) pieces.push('<span style="font-family:monospace">' + escapeHtml(event.url) + '</span>')
    if (event.detail) pieces.push(escapeHtml(event.detail))

    return '<div style="padding:5px 0;border-bottom:1px solid #f3f4f6;line-height:1.35">' + pieces.join('<br>') + '</div>'
  }).join('')
}

function loadStreams(callback) {
  chrome.storage.local.get('streams', function(result) {
    currentStreams = Array.isArray(result && result.streams) ? result.streams : []
    refreshResolvedItems().finally(function() {
      if (callback) callback()
    })
  })
}

function loadDiagnostics(callback) {
  if (!currentTab || typeof currentTab.id !== 'number') {
    backgroundResponsive = false
    currentDiagnostics = null
    currentDebugReport = ''
    renderDebug()
    if (callback) callback()
    return
  }

  sendRuntimeMessage({
    action: 'getDebugState',
    pageTitle: currentTab.title || '',
    pageUrl: currentTab.url || '',
    tabId: currentTab.id,
  }, function(error, response) {
    backgroundResponsive = !error && Boolean(response && response.ok)
    currentDiagnostics = response && response.state ? response.state : null
    currentDebugReport = response && response.report ? response.report : ''
    renderDebug()
    if (callback) callback()
  })
}

function loadAll() {
  getActiveTab(function(tab) {
    currentTab = tab
    loadStreams(function() {
      loadDiagnostics()
    })
  })
}

function clearAll() {
  currentStreams = []
  currentResolvedItems = []
  currentStream = null
  currentResolvedDetails = null
  currentResolvedKey = ''
  currentSelectedUrl = ''
  currentListBusy = false
  currentResolveToken += 1
  currentActionMessage = ''
  currentActionBusy = false

  chrome.storage.local.set({ streams: [] }, function() {
    if (currentTab && typeof currentTab.id === 'number') {
      sendRuntimeMessage({ action: 'clearDebugState', tabId: currentTab.id }, function() {
        currentDiagnostics = null
        currentDebugReport = ''
        renderStreams()
        renderDebug()
      })
      return
    }

    renderStreams()
    renderDebug()
  })
}

function runDebugProbe() {
  if (!currentTab || typeof currentTab.id !== 'number') {
    renderDebug()
    return
  }

  chrome.tabs.sendMessage(currentTab.id, { action: 'debug-ping' }, function() {
    void chrome.runtime.lastError
    setTimeout(function() {
      loadDiagnostics()
      loadStreams()
    }, 250)
  })
}

function copyToClipboard(text, button, idleText) {
  if (!text) return

  navigator.clipboard.writeText(text).then(function() {
    button.textContent = 'Copiado!'
    setTimeout(function() {
      button.textContent = idleText
    }, 1800)
  })
}

function copyDebugReport(button) {
  if (!currentDebugReport) return
  copyToClipboard(currentDebugReport, button, 'Copiar diagnostico')
}

function copySelectedUrl(button) {
  var url = getEffectiveDownloadUrl()
  if (!url) return
  copyToClipboard(url, button, 'Copiar URL')
}

function getPrimaryDownloadMode() {
  if (!currentResolvedDetails) return ''
  if (currentResolvedDetails.canDownloadDirect) return 'direct'
  if (currentResolvedDetails.canDownloadHls) return 'hls'
  if (currentResolvedDetails.canDownloadVimeoPlaylist) return 'vimeo-playlist'
  if (currentResolvedDetails.canDownloadDash) return 'dash'
  return ''
}

function downloadSelectedStream(button) {
  var option = getSelectedOption()
  var downloadUrl = option && option.url ? option.url : getEffectiveDownloadUrl()

  if (!downloadUrl || !currentResolvedDetails || !currentResolvedDetails.canDownloadDirect) {
    renderPreview()
    return
  }

  if (isPartialMediaFragmentUrl(downloadUrl)) {
    setActionState(
      'Fragmento adaptativo detectado. A extensao bloqueou este trecho parcial e vai aguardar o manifesto real do Vimeo.',
      true
    )
    setTimeout(function() {
      clearActionState()
    }, 2200)
    return
  }

  button.textContent = 'Iniciando...'
  setActionState('Iniciando download direto...', true)
  sendRuntimeMessage({
    action: 'downloadResolvedStream',
    filename: buildDownloadFilename(currentResolvedDetails.title, option, downloadUrl),
    title: currentResolvedDetails.title || '',
    url: downloadUrl,
  }, function(error, response) {
    if (error || !response || !response.ok) {
      setActionState(
        response && response.error
          ? response.error
          : 'Falha ao iniciar o download direto.',
        true
      )
      setTimeout(function() {
        clearActionState()
      }, 1500)
      return
    }

    setActionState('Baixando arquivo direto...', true)
    setTimeout(function() {
      clearActionState()
    }, 1600)
  })
}

async function downloadSelectedHlsStream() {
  var option = getSelectedOption()
  var manifestUrl = option && option.url ? option.url : getEffectiveDownloadUrl()

  if (!manifestUrl || !currentResolvedDetails || !currentResolvedDetails.canDownloadHls) {
    renderPreview()
    return
  }

  if (!hlsDownloadApi) {
    setActionState('O motor HLS da extensao nao foi carregado corretamente.', true)
    setTimeout(function() {
      clearActionState()
    }, 2200)
    return
  }

  try {
    setActionState('Preparando stream HLS...', true)
    setActionState('Baixando segmentos do stream HLS...', true)

    var blob = await hlsDownloadApi.downloadHlsAsMp4({
      manifestUrl: manifestUrl,
      onStatus: function(percent, message) {
        var safePercent = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null
        if (safePercent === null) {
          setActionState(message, true)
          return
        }

        setActionState(message + ' ' + safePercent + '%', true)
      },
    })

    setActionState('Salvando video no PC...', true)
    await hlsDownloadApi.saveBlobToDisk(
      blob,
      buildDownloadFilename(currentResolvedDetails.title, option, manifestUrl)
    )
    setActionState('Download iniciado no computador.', true)
  } catch (error) {
    setActionState(
      error && error.message
        ? error.message
        : 'Falha ao converter o stream HLS para MP4.',
      true
    )
  } finally {
    setTimeout(function() {
      clearActionState()
    }, 2200)
  }
}

async function downloadSelectedVimeoPlaylistStream() {
  var option = getSelectedOption()
  var manifestUrl = option && option.playlistUrl ? option.playlistUrl : getEffectiveDownloadUrl()

  if (!option || !manifestUrl || !currentResolvedDetails || !currentResolvedDetails.canDownloadVimeoPlaylist) {
    renderPreview()
    return
  }

  if (!hlsDownloadApi || typeof hlsDownloadApi.downloadVimeoPlaylistAsMp4 !== 'function') {
    setActionState('O motor Vimeo da extensao nao foi carregado corretamente.', true)
    setTimeout(function() {
      clearActionState()
    }, 2200)
    return
  }

  try {
    setActionState('Preparando playlist segmentada do Vimeo...', true)

    var blob = await hlsDownloadApi.downloadVimeoPlaylistAsMp4({
      option: option,
      playlistUrl: manifestUrl,
      onStatus: function(percent, message) {
        var safePercent = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null
        if (safePercent === null) {
          setActionState(message, true)
          return
        }

        setActionState(message + ' ' + safePercent + '%', true)
      },
    })

    setActionState('Salvando video no PC...', true)
    await hlsDownloadApi.saveBlobToDisk(
      blob,
      buildDownloadFilename(currentResolvedDetails.title, option, manifestUrl)
    )
    setActionState('Download iniciado no computador.', true)
  } catch (error) {
    setActionState(
      error && error.message
        ? error.message
        : 'Falha ao montar o Vimeo segmentado em MP4.',
      true
    )
  } finally {
    setTimeout(function() {
      clearActionState()
    }, 2200)
  }
}

async function downloadSelectedDashStream() {
  var option = getSelectedOption()
  var mpdUrl = option && option.url ? option.url : getEffectiveDownloadUrl()

  if (!mpdUrl || !currentResolvedDetails || !currentResolvedDetails.canDownloadDash) {
    renderPreview()
    return
  }

  if (!hlsDownloadApi || typeof hlsDownloadApi.downloadDashAsMp4 !== 'function') {
    setActionState('O motor DASH da extensao nao foi carregado corretamente.', true)
    setTimeout(function() { clearActionState() }, 2200)
    return
  }

  try {
    setActionState('Preparando stream DASH...', true)

    var blob = await hlsDownloadApi.downloadDashAsMp4({
      mpdUrl: mpdUrl,
      onStatus: function(percent, message) {
        var safePercent = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null
        setActionState(message + (safePercent !== null ? ' ' + safePercent + '%' : ''), true)
      },
    })

    setActionState('Salvando video no PC...', true)
    await hlsDownloadApi.saveBlobToDisk(
      blob,
      buildDownloadFilename(currentResolvedDetails.title, option, mpdUrl)
    )
    setActionState('Download iniciado no computador.', true)
  } catch (error) {
    setActionState(
      error && error.message ? error.message : 'Falha ao converter o stream DASH para MP4.',
      true
    )
  } finally {
    setTimeout(function() { clearActionState() }, 2200)
  }
}

function handlePrimaryAction(button) {
  var mode = getPrimaryDownloadMode()

  if (mode === 'hls') {
    downloadSelectedHlsStream(button)
    return
  }

  if (mode === 'vimeo-playlist') {
    downloadSelectedVimeoPlaylistStream(button)
    return
  }

  if (mode === 'dash') {
    downloadSelectedDashStream()
    return
  }

  downloadSelectedStream(button)
}

document.getElementById('btnRefresh').addEventListener('click', loadAll)
document.getElementById('btnClear').addEventListener('click', clearAll)
document.getElementById('btnPrimaryAction').addEventListener('click', function(event) {
  handlePrimaryAction(event.currentTarget)
})
document.getElementById('btnCopyUrl').addEventListener('click', function(event) {
  copySelectedUrl(event.currentTarget)
})
document.getElementById('qualitySelect').addEventListener('change', function(event) {
  currentSelectedUrl = event.target.value
})
document.getElementById('btnDebugToggle').addEventListener('click', function() {
  debugOpen = !debugOpen
  renderDebug()
})
document.getElementById('btnRunDebug').addEventListener('click', runDebugProbe)
document.getElementById('btnCopyDebug').addEventListener('click', function(event) {
  copyDebugReport(event.currentTarget)
})
document.getElementById('list').addEventListener('click', function(event) {
  var target = event.target
  var button = target && typeof target.closest === 'function'
    ? target.closest('button[data-action]')
    : null

  if (!button) return

  if (button.getAttribute('data-action') !== 'select-stream') return

  var index = Number(button.getAttribute('data-index'))
  if (Number.isNaN(index)) return

  var resolvedItems = getResolvedItems()
  if (!resolvedItems[index]) return

  applyResolvedItem(resolvedItems[index])
  clearActionState()
  renderStreams()
})

loadAll()

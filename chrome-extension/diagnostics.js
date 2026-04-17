;(function(root) {
  var MAX_EVENTS = 50

  function createDiagnosticsState(tabId) {
    return {
      tabId: typeof tabId === 'number' ? tabId : -1,
      pageUrl: '',
      pageTitle: '',
      contentScriptSeen: false,
      interceptorSeen: false,
      lastRequestUrl: '',
      lastResponseUrl: '',
      lastManifestUrl: '',
      lastManifestType: '',
      lastError: '',
      updatedAt: 0,
      counts: {
        requestsSeen: 0,
        responsesSeen: 0,
        streamsFound: 0,
        errors: 0,
        messagesSeen: 0,
      },
      events: [],
    }
  }

  function ensureDiagnosticsState(raw, tabId) {
    var state = createDiagnosticsState(tabId)
    if (!raw || typeof raw !== 'object') return state

    state.pageUrl = String(raw.pageUrl || '')
    state.pageTitle = String(raw.pageTitle || '')
    state.contentScriptSeen = Boolean(raw.contentScriptSeen)
    state.interceptorSeen = Boolean(raw.interceptorSeen)
    state.lastRequestUrl = String(raw.lastRequestUrl || '')
    state.lastResponseUrl = String(raw.lastResponseUrl || '')
    state.lastManifestUrl = String(raw.lastManifestUrl || '')
    state.lastManifestType = String(raw.lastManifestType || '')
    state.lastError = String(raw.lastError || '')
    state.updatedAt = Number(raw.updatedAt || 0)
    state.counts = {
      requestsSeen: Number(raw.counts && raw.counts.requestsSeen || 0),
      responsesSeen: Number(raw.counts && raw.counts.responsesSeen || 0),
      streamsFound: Number(raw.counts && raw.counts.streamsFound || 0),
      errors: Number(raw.counts && raw.counts.errors || 0),
      messagesSeen: Number(raw.counts && raw.counts.messagesSeen || 0),
    }
    state.events = Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : []

    return state
  }

  function normalizeEvent(event) {
    return {
      ts: Number(event && event.ts || Date.now()),
      kind: String(event && event.kind || 'unknown'),
      source: String(event && event.source || 'unknown'),
      url: String(event && event.url || ''),
      detail: String(event && event.detail || ''),
      pageUrl: String(event && event.pageUrl || ''),
      pageTitle: String(event && event.pageTitle || ''),
      streamType: String(event && event.streamType || ''),
      frameType: String(event && event.frameType || ''),
    }
  }

  function applyDiagnosticsEvent(currentState, event) {
    var state = ensureDiagnosticsState(currentState, currentState && currentState.tabId)
    var entry = normalizeEvent(event)

    state.updatedAt = entry.ts

    if (entry.pageUrl && (entry.frameType === 'top' || !state.pageUrl)) {
      state.pageUrl = entry.pageUrl
    }

    if (entry.pageTitle && (entry.frameType === 'top' || !state.pageTitle)) {
      state.pageTitle = entry.pageTitle
    }

    switch (entry.kind) {
      case 'content-loaded':
      case 'content-ping':
        state.contentScriptSeen = true
        state.counts.messagesSeen += 1
        break
      case 'interceptor-loaded':
      case 'interceptor-pong':
        state.interceptorSeen = true
        state.counts.messagesSeen += 1
        break
      case 'network-request':
        state.lastRequestUrl = entry.url
        state.counts.requestsSeen += 1
        break
      case 'network-response':
      case 'body-inspected':
        state.lastResponseUrl = entry.url
        state.counts.responsesSeen += 1
        break
      case 'stream-found':
        state.lastManifestUrl = entry.url
        state.lastManifestType = entry.streamType
        state.counts.streamsFound += 1
        break
      case 'error':
        state.lastError = entry.detail || entry.url || entry.kind
        state.counts.errors += 1
        break
      default:
        state.counts.messagesSeen += 1
        break
    }

    state.events = state.events.concat(entry).slice(-MAX_EVENTS)
    return state
  }

  function formatDiagnosticsReport(state, context) {
    var safe = ensureDiagnosticsState(state, state && state.tabId)
    var info = context || {}
    var lines = []

    lines.push('BaixarHSL - Diagnostico da extensao')
    lines.push('Tab ID: ' + String(safe.tabId))
    lines.push('Aba ativa: ' + String(info.pageTitle || safe.pageTitle || '(sem titulo)'))
    lines.push('URL: ' + String(info.pageUrl || safe.pageUrl || '(sem URL)'))
    lines.push('Background: ' + (info.backgroundResponsive ? 'ok' : 'sem resposta'))
    lines.push('Content script: ' + (safe.contentScriptSeen ? 'detectado' : 'nao detectado'))
    lines.push('Interceptor: ' + (safe.interceptorSeen ? 'detectado' : 'nao detectado'))
    lines.push('Requests relevantes: ' + String(safe.counts.requestsSeen))
    lines.push('Responses relevantes: ' + String(safe.counts.responsesSeen))
    lines.push('Streams encontrados: ' + String(safe.counts.streamsFound))
    lines.push('Ultimo manifesto: ' + String(safe.lastManifestUrl || '(nenhum)'))
    lines.push('Ultimo tipo: ' + String(safe.lastManifestType || '(nenhum)'))
    lines.push('Ultimo erro: ' + String(safe.lastError || '(nenhum)'))
    lines.push('Eventos recentes:')

    for (var i = 0; i < safe.events.length; i++) {
      var event = safe.events[i]
      var parts = [String(event.ts), event.source + ':' + event.kind]
      if (event.url) parts.push(event.url)
      if (event.detail) parts.push(event.detail)
      lines.push('- ' + parts.join(' | '))
    }

    return lines.join('\n')
  }

  var api = {
    createDiagnosticsState: createDiagnosticsState,
    ensureDiagnosticsState: ensureDiagnosticsState,
    applyDiagnosticsEvent: applyDiagnosticsEvent,
    formatDiagnosticsReport: formatDiagnosticsReport,
  }

  root.BaixarHSLDiagnostics = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

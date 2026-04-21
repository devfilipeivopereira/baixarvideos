;(function(root) {
  var activeJobs = new Map()
  var CANCELLED_MESSAGE = 'Download cancelado pelo usuario.'

  function nowTs() {
    return Date.now()
  }

  function readJob(jobId) {
    return activeJobs.get(jobId) || null
  }

  function upsertJob(jobId, patch) {
    var previous = readJob(jobId) || {}
    var next = Object.assign({}, previous, patch, {
      jobId: jobId,
      updatedAt: nowTs(),
    })
    activeJobs.set(jobId, next)
    return next
  }

  function notifyBackground(jobId, status, message, percent, errorText) {
    try {
      chrome.runtime.sendMessage({
        action: 'background-download-status',
        target: 'background',
        error: errorText ? String(errorText) : '',
        jobId: jobId,
        message: message ? String(message) : '',
        percent: typeof percent === 'number' ? percent : null,
        status: String(status || 'running'),
        ts: nowTs(),
      })
    } catch (error) {
      void error
    }
  }

  function isCancellationRequested(jobId) {
    var job = readJob(jobId)
    if (!job) return false
    return Boolean(job.cancelRequested) || job.status === 'cancelling' || job.status === 'cancelled'
  }

  function createCancelledError() {
    var error = new Error(CANCELLED_MESSAGE)
    error.name = 'BackgroundDownloadCancelledError'
    return error
  }

  function isCancelledError(error) {
    if (!error) return false
    if (error.name === 'BackgroundDownloadCancelledError') return true
    return String(error.message || '').toLowerCase().includes('cancelado')
  }

  function requestCancelJob(jobId) {
    var currentJob = readJob(jobId)
    if (!currentJob) {
      return {
        error: 'Job de download em segundo plano nao encontrado.',
        ok: false,
      }
    }

    if (
      currentJob.status === 'completed' ||
      currentJob.status === 'failed' ||
      currentJob.status === 'cancelled'
    ) {
      return {
        alreadyStopped: true,
        message: currentJob.status === 'completed'
          ? 'Este download ja foi concluido.'
          : currentJob.status === 'failed'
            ? 'Este download ja falhou e nao esta em execucao.'
            : 'Este download ja foi cancelado.',
        ok: true,
      }
    }

    var cancellingMessage = 'Cancelando download em segundo plano...'
    upsertJob(jobId, {
      cancelRequested: true,
      message: cancellingMessage,
      status: 'cancelling',
    })
    notifyBackground(jobId, 'cancelling', cancellingMessage, currentJob && typeof currentJob.percent === 'number' ? currentJob.percent : null, '')

    return {
      message: cancellingMessage,
      ok: true,
    }
  }

  function parseJsonObject(text) {
    if (typeof text !== 'string') return null
    var trimmed = text.trim()
    if (!trimmed || trimmed.charAt(0) !== '{') return null

    try {
      var parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch (error) {
      void error
      return null
    }
  }

  function getChromeStorageArea(areaName) {
    try {
      if (typeof chrome === 'undefined' || !chrome || !chrome.storage) return null
      var area = chrome.storage[areaName]
      if (!area || typeof area.get !== 'function') return null
      return area
    } catch (error) {
      void error
      return null
    }
  }

  async function saveBlobWithFileHandle(fileHandleKey, blob) {
    var store = root.BaixarHSLFileHandleStore
    if (!fileHandleKey) return false
    if (!store || typeof store.getStoredHandle !== 'function') {
      throw new Error('Armazenamento local do arquivo de destino indisponivel.')
    }

    var entry = await store.getStoredHandle(String(fileHandleKey || ''))
    if (!entry || !entry.handle) {
      throw new Error('Arquivo de destino nao encontrado. Escolha novamente onde salvar.')
    }

    var handle = entry.handle
    if (typeof handle.createWritable !== 'function') {
      throw new Error('O arquivo escolhido nao aceita gravacao direta.')
    }

    if (typeof handle.queryPermission === 'function') {
      var permission = await handle.queryPermission({ mode: 'readwrite' })
      if (permission === 'denied') {
        throw new Error('Permissao de gravacao negada para o arquivo escolhido.')
      }
    }

    var writable = await handle.createWritable()
    try {
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      try {
        await writable.abort()
      } catch (abortError) {
        void abortError
      }
      throw error
    }

    if (typeof store.deleteStoredHandle === 'function') {
      await store.deleteStoredHandle(String(fileHandleKey || ''))
    }

    return true
  }

  function normalizeVimeoPlaylistBody(body) {
    if (typeof body !== 'string') return null
    var trimmed = body.trim()
    if (!trimmed) return null

    var parsed = parseJsonObject(trimmed)
    if (!parsed) return null
    if (!Array.isArray(parsed.video) || parsed.video.length === 0) return null

    return trimmed
  }

  function normalizeVimeoPlaylistCacheEntry(value, fallbackSourceUrl) {
    var fallback = isVimeoPlaylistUrl(fallbackSourceUrl) ? String(fallbackSourceUrl || '') : ''

    if (typeof value === 'string') {
      var directBody = normalizeVimeoPlaylistBody(value)
      if (!directBody) return null
      return {
        body: directBody,
        sourceUrl: fallback,
      }
    }

    if (!value || typeof value !== 'object') return null

    var body = normalizeVimeoPlaylistBody(value.body || '')
    if (!body) return null

    var sourceUrl = isVimeoPlaylistUrl(value.sourceUrl) ? String(value.sourceUrl || '') : fallback
    return {
      body: body,
      sourceUrl: sourceUrl,
    }
  }

  function isVimeoPlaylistUrl(url) {
    var lower = String(url || '').toLowerCase()
    if (!lower.includes('vimeocdn.com')) return false
    return lower.includes('playlist.json') || lower.includes('master.json')
  }

  function getVimeoPlaylistLookupKey(url) {
    if (!isVimeoPlaylistUrl(url)) return ''
    try {
      var parsed = new URL(String(url || ''))
      var pathname = String(parsed.pathname || '')
      var lowerPath = pathname.toLowerCase()
      var v2Index = lowerPath.indexOf('/v2/')
      if (v2Index >= 0) {
        return 'v2:' + pathname.slice(v2Index)
      }
      return parsed.origin + pathname
    } catch (error) {
      void error
      return ''
    }
  }

  function getVimeoPlaylistCacheKey(url) {
    var lookupKey = getVimeoPlaylistLookupKey(url)
    if (!lookupKey) return ''
    return 'vp_' + lookupKey
  }

  function scoreVimeoPlaylistCandidateUrl(url) {
    try {
      var parsed = new URL(String(url || ''))
      var score = 0
      if (parsed.searchParams.has('pathsig')) score += 12
      if (parsed.searchParams.has('qsr')) score += 10
      if (parsed.searchParams.has('r')) score += 8
      if (parsed.searchParams.has('rh')) score += 8
      if (parsed.searchParams.has('base64_init')) score += 4
      if (parsed.hostname === 'vod-adaptive-ak.vimeocdn.com') score += 18
      if (parsed.hostname.indexOf('vod-adaptive') >= 0) score += 8
      if (parsed.hostname.indexOf('skyfire.vimeocdn.com') >= 0) score -= 12
      score += Math.min(6, Math.floor(parsed.search.length / 24))
      return score
    } catch (error) {
      void error
      return 0
    }
  }

  function parsePlaylistSelectionHash(url) {
    var result = { audio: '', video: '' }
    try {
      var parsed = new URL(String(url || ''))
      var hash = String(parsed.hash || '')
      if (hash.startsWith('#')) hash = hash.slice(1)
      if (!hash) return result

      var parts = hash.split('&')
      for (var index = 0; index < parts.length; index += 1) {
        var pair = parts[index]
        if (!pair) continue
        var equalIndex = pair.indexOf('=')
        var rawKey = equalIndex >= 0 ? pair.slice(0, equalIndex) : pair
        var rawValue = equalIndex >= 0 ? pair.slice(equalIndex + 1) : ''
        var key = decodeURIComponent(String(rawKey || '')).trim().toLowerCase()
        var value = decodeURIComponent(String(rawValue || '')).trim()
        if (!value) continue
        if (key === 'video') result.video = value
        if (key === 'audio') result.audio = value
      }

      return result
    } catch (error) {
      void error
      return result
    }
  }

  function selectPreferredPlaylistOption(options, selectedUrl) {
    var list = Array.isArray(options) ? options : []
    if (list.length === 0) return null

    var selected = String(selectedUrl || '')
    if (selected) {
      for (var i = 0; i < list.length; i += 1) {
        if (String(list[i] && list[i].url || '') === selected) {
          return list[i]
        }
      }
    }

    var selectionHash = parsePlaylistSelectionHash(selected)
    if (selectionHash.video || selectionHash.audio) {
      for (var index = 0; index < list.length; index += 1) {
        var option = list[index]
        if (!option || !option.url) continue
        var optionHash = parsePlaylistSelectionHash(option.url)
        var videoMatches = !selectionHash.video || optionHash.video === selectionHash.video
        var audioMatches = !selectionHash.audio || optionHash.audio === selectionHash.audio
        if (videoMatches && audioMatches) {
          return option
        }
      }
    }

    return list[0]
  }

  async function getCachedVimeoPlaylistBody(url, providedEntry) {
    var provided = normalizeVimeoPlaylistCacheEntry(providedEntry, url)
    if (provided) return provided

    var cacheKey = getVimeoPlaylistCacheKey(url)
    if (!cacheKey) return null

    var sessionArea = getChromeStorageArea('session')
    if (!sessionArea) return null

    var sessionData = await new Promise(function(resolve) {
      sessionArea.get(cacheKey, function(result) {
        resolve(result || {})
      })
    })

    var cachedEntry = normalizeVimeoPlaylistCacheEntry(sessionData[cacheKey], url)
    if (cachedEntry) return cachedEntry

    if (sessionData[cacheKey]) {
      chrome.storage.session.remove(cacheKey)
    }

    return null
  }

  async function getVimeoPlaylistCandidateUrls(primaryUrl, tabId, extraCandidates) {
    var normalizedPrimary = String(primaryUrl || '').trim()
    if (!isVimeoPlaylistUrl(normalizedPrimary)) return []

    var candidates = []
    var seen = Object.create(null)
    var lookupKey = getVimeoPlaylistLookupKey(primaryUrl)
    if (!lookupKey) return [normalizedPrimary]

    var streams = []
    var localArea = getChromeStorageArea('local')
    if (localArea) {
      streams = await new Promise(function(resolve) {
        localArea.get('streams', function(result) {
          resolve(Array.isArray(result && result.streams) ? result.streams : [])
        })
      })
    }

    var pool = streams
      .filter(function(stream) {
        if (!stream || stream.type !== 'vimeo' || typeof stream.url !== 'string') return false
        return getVimeoPlaylistLookupKey(stream.url) === lookupKey
      })
      .map(function(stream) {
        var sameTabBonus = (typeof tabId === 'number' && tabId >= 0 && stream.tabId === tabId) ? 100 : 0
        return {
          score: scoreVimeoPlaylistCandidateUrl(stream.url) + sameTabBonus,
          timestamp: Number(stream.timestamp || 0),
          url: String(stream.url || ''),
        }
      })

    if (Array.isArray(extraCandidates)) {
      extraCandidates.forEach(function(url, index) {
        var normalized = String(url || '').trim()
        if (!normalized || !isVimeoPlaylistUrl(normalized)) return
        pool.push({
          score: scoreVimeoPlaylistCandidateUrl(normalized) + 40,
          timestamp: Date.now() + 10 + index,
          url: normalized,
        })
      })
    }

    var primaryTabBonus = typeof tabId === 'number' && tabId >= 0 ? 100 : 0
    pool.push({
      score: scoreVimeoPlaylistCandidateUrl(normalizedPrimary) + primaryTabBonus + 6,
      timestamp: Date.now() + 1,
      url: normalizedPrimary,
    })

    pool
      .sort(function(left, right) {
        if (right.score !== left.score) return right.score - left.score
        return right.timestamp - left.timestamp
      })
      .forEach(function(candidate) {
        var normalized = String(candidate && candidate.url || '').trim()
        if (!normalized || !isVimeoPlaylistUrl(normalized)) return
        if (seen[normalized]) return
        seen[normalized] = true
        candidates.push(normalized)
      })

    if (candidates.length === 0) {
      candidates.push(normalizedPrimary)
    }

    return candidates
  }

  async function resolveVimeoOption(playlistUrl, selectedUrl, tabId, extraCandidates, providedCachedPlaylist) {
    if (!playlistUrl) {
      throw new Error('Playlist Vimeo ausente para conversao em segundo plano.')
    }

    if (!root.BaixarHSLVimeoPlaylist || typeof root.BaixarHSLVimeoPlaylist.resolvePlaylistDetails !== 'function') {
      throw new Error('Parser de playlist do Vimeo nao foi carregado no worker.')
    }

    var candidates = await getVimeoPlaylistCandidateUrls(playlistUrl, tabId, extraCandidates)
    if (candidates.length === 0) candidates = [String(playlistUrl || '')]

    var lastHttpStatus = 0
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var candidateUrl = candidates[candidateIndex]
      var cachedPlaylist = await getCachedVimeoPlaylistBody(candidateUrl, providedCachedPlaylist)
      var playlistText = cachedPlaylist ? cachedPlaylist.body : null
      var playlistBaseUrl = cachedPlaylist && cachedPlaylist.sourceUrl ? cachedPlaylist.sourceUrl : candidateUrl

      if (!playlistText) {
        try {
          var response = await fetch(candidateUrl, { credentials: 'include', cache: 'no-store' })
          if (!response.ok) {
            lastHttpStatus = Number(response.status || 0)
            continue
          }

          var text = await response.text()
          playlistText = normalizeVimeoPlaylistBody(text)
          if (!playlistText) continue

          var cacheKey = getVimeoPlaylistCacheKey(candidateUrl)
          var sessionArea = getChromeStorageArea('session')
          if (cacheKey && sessionArea) {
            var payload = {}
            payload[cacheKey] = {
              body: playlistText,
              cachedAt: Date.now(),
              sourceUrl: candidateUrl,
            }
            sessionArea.set(payload)
          }
        } catch (error) {
          void error
          continue
        }
      }

      var details = root.BaixarHSLVimeoPlaylist.resolvePlaylistDetails(playlistText, playlistBaseUrl)
      var options = details && Array.isArray(details.options) ? details.options : []
      if (!options.length) continue

      var selectedOption = selectPreferredPlaylistOption(options, selectedUrl)
      if (!selectedOption) continue

      return {
        option: selectedOption,
        playlistUrl: String(selectedOption.playlistUrl || candidateUrl),
      }
    }

    if (lastHttpStatus > 0) {
      throw new Error('Falha ao buscar playlist Vimeo: HTTP ' + lastHttpStatus)
    }

    throw new Error('Playlist segmentada sem faixas de video/audio utilizaveis.')
  }

  async function runConversion(job) {
    var downloadApi = root.BaixarHSLHlsDownload
    if (!downloadApi) {
      throw new Error('Motor de download nao foi carregado no worker.')
    }

    var mode = String(job.mode || '')
    var tabId = typeof job.tabId === 'number' ? job.tabId : -1
    var blob = null

    var shouldCancel = function() {
      return isCancellationRequested(job.jobId)
    }

    var ensureNotCancelled = function() {
      if (shouldCancel()) {
        throw createCancelledError()
      }
    }

    var onStatus = function(percent, message) {
      if (shouldCancel()) return
      upsertJob(job.jobId, {
        message: message ? String(message) : '',
        percent: typeof percent === 'number' ? percent : null,
        status: 'running',
      })
      notifyBackground(job.jobId, 'running', message, percent, '')
    }

    ensureNotCancelled()

    if (mode === 'hls') {
      blob = await downloadApi.downloadHlsAsMp4({
        manifestUrl: String(job.manifestUrl || ''),
        onStatus: onStatus,
        shouldCancel: shouldCancel,
        tabId: tabId,
      })
    } else if (mode === 'dash') {
      blob = await downloadApi.downloadDashAsMp4({
        mpdUrl: String(job.mpdUrl || ''),
        onStatus: onStatus,
        shouldCancel: shouldCancel,
        tabId: tabId,
      })
    } else if (mode === 'vimeo-playlist') {
      var resolvedPlaylist = await resolveVimeoOption(
        String(job.playlistUrl || ''),
        String(job.selectedUrl || ''),
        tabId,
        Array.isArray(job.candidateUrls) ? job.candidateUrls : [],
        job.cachedPlaylist && typeof job.cachedPlaylist === 'object' ? job.cachedPlaylist : null
      )
      ensureNotCancelled()
      blob = await downloadApi.downloadVimeoPlaylistAsMp4({
        onStatus: onStatus,
        option: resolvedPlaylist.option,
        playlistUrl: String(resolvedPlaylist.playlistUrl || job.playlistUrl || ''),
        shouldCancel: shouldCancel,
        tabId: tabId,
      })
    } else {
      throw new Error('Modo de conversao em segundo plano nao suportado: ' + mode)
    }

    ensureNotCancelled()
    var finalStatusMessage = job.saveFileHandleKey
      ? 'Salvando video no local escolhido...'
      : 'Salvando video no computador...'
    onStatus(98, finalStatusMessage)
    ensureNotCancelled()
    if (job.saveFileHandleKey) {
      await saveBlobWithFileHandle(String(job.saveFileHandleKey || ''), blob)
    } else {
      await downloadApi.saveBlobToDisk(blob, String(job.filename || 'video.mp4'))
    }
    ensureNotCancelled()
    onStatus(100, job.saveFileHandleKey ? 'Video salvo no local escolhido.' : 'Download iniciado no computador.')
  }

  function startJob(job) {
    if (!job || !job.jobId) {
      throw new Error('Job em segundo plano invalido.')
    }

    if (readJob(job.jobId) && readJob(job.jobId).status === 'running') {
      return
    }

    upsertJob(job.jobId, {
      cancelRequested: false,
      error: '',
      filename: String(job.filename || 'video.mp4'),
      job: Object.assign({}, job),
      message: 'Iniciando processamento em segundo plano...',
      mode: String(job.mode || ''),
      percent: 0,
      saveFileHandleKey: String(job.saveFileHandleKey || ''),
      startedAt: nowTs(),
      status: 'running',
      tabId: typeof job.tabId === 'number' ? job.tabId : -1,
    })
    notifyBackground(job.jobId, 'running', 'Iniciando processamento em segundo plano...', 0, '')

    runConversion(job)
      .then(function() {
        upsertJob(job.jobId, {
          cancelRequested: false,
          error: '',
          message: job.saveFileHandleKey ? 'Video salvo no local escolhido.' : 'Download iniciado no computador.',
          percent: 100,
          status: 'completed',
        })
        notifyBackground(
          job.jobId,
          'completed',
          job.saveFileHandleKey ? 'Video salvo no local escolhido.' : 'Download iniciado no computador.',
          100,
          ''
        )
      })
      .catch(function(error) {
        if (isCancelledError(error)) {
          upsertJob(job.jobId, {
            cancelRequested: false,
            error: '',
            message: CANCELLED_MESSAGE,
            percent: null,
            status: 'cancelled',
          })
          notifyBackground(job.jobId, 'cancelled', CANCELLED_MESSAGE, null, '')
          return
        }

        var errorMessage = error && error.message
          ? String(error.message)
          : 'Falha durante o processamento em segundo plano.'
        upsertJob(job.jobId, {
          cancelRequested: false,
          error: errorMessage,
          message: errorMessage,
          percent: null,
          status: 'failed',
        })
        notifyBackground(job.jobId, 'failed', errorMessage, null, errorMessage)
      })
  }

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    void sender

    if (!message || typeof message !== 'object') return false
    if (message.target !== 'download-worker') return false

    if (message.action === 'run-background-conversion-job') {
      try {
        startJob(message.job || {})
        sendResponse({
          jobId: message.job && message.job.jobId ? String(message.job.jobId) : '',
          ok: true,
        })
      } catch (error) {
        sendResponse({
          error: error && error.message ? error.message : 'Falha ao iniciar o worker.',
          ok: false,
        })
      }
      return false
    }

    if (message.action === 'cancel-background-conversion-job') {
      var cancelJobId = String(message.jobId || '')
      if (!cancelJobId) {
        sendResponse({
          error: 'jobId ausente para cancelamento.',
          ok: false,
        })
        return false
      }

      sendResponse(requestCancelJob(cancelJobId))
      return false
    }

    if (message.action === 'get-background-download-job') {
      var jobId = String(message.jobId || '')
      if (!jobId) {
        sendResponse({ ok: true, jobs: Array.from(activeJobs.values()) })
        return false
      }
      sendResponse({ job: readJob(jobId), ok: true })
      return false
    }

    return false
  })
})(typeof self !== 'undefined' ? self : globalThis)

// Importar mÃ³dulos de suporte (com proteÃ§Ã£o contra falhas)
try {
  importScripts('detector.js', 'diagnostics.js', 'stream-details.js', 'hls.js', 'vimeo-playlist.js')
} catch (e) {
  console.error('[BaixarHSL] Falha ao carregar mÃ³dulos:', e && e.message)
}

var STREAMS_KEY = 'streams'
var DIAG_KEY = 'diagnosticsByTab'
var VIMEO_CFG_KEY_PREFIX = 'vc_'
var VIMEO_PLAYLIST_KEY_PREFIX = 'vp_'
var MAX_STREAMS = 50
var resolvedCache = new Map()
var recentSavedStreams = new Map()
var backgroundDownloadJobs = new Map()
var downloadWorkerCreatePromise = null
var DOWNLOAD_WORKER_PAGE = 'download-worker.html'

function createBackgroundJobId() {
  return 'bg-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8)
}

function upsertBackgroundDownloadJob(jobId, patch) {
  if (!jobId) return null
  var previous = backgroundDownloadJobs.get(jobId) || {}
  var next = Object.assign({}, previous, patch, {
    jobId: jobId,
    updatedAt: Date.now(),
  })
  backgroundDownloadJobs.set(jobId, next)
  return next
}

function trimBackgroundDownloadJobs() {
  if (backgroundDownloadJobs.size <= 120) return
  var now = Date.now()
  var staleBefore = now - (1000 * 60 * 60 * 24)
  var allJobs = Array.from(backgroundDownloadJobs.values())

  allJobs.forEach(function(job) {
    if (!job || typeof job.updatedAt !== 'number' || job.updatedAt < staleBefore) {
      if (job && job.jobId) backgroundDownloadJobs.delete(job.jobId)
    }
  })

  if (backgroundDownloadJobs.size <= 100) return

  allJobs
    .filter(function(job) { return job && job.jobId })
    .sort(function(a, b) { return Number(a.updatedAt || 0) - Number(b.updatedAt || 0) })
    .slice(0, Math.max(0, backgroundDownloadJobs.size - 100))
    .forEach(function(job) {
      backgroundDownloadJobs.delete(job.jobId)
    })
}

function isBackgroundJobActive(job) {
  if (!job) return false
  return job.status === 'queued' || job.status === 'running' || job.status === 'cancelling'
}

function findBackgroundJobByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null
  var jobs = Array.from(backgroundDownloadJobs.values())
    .filter(function(job) {
      return job && String(job.dedupeKey || '') === String(dedupeKey || '')
    })
    .sort(function(a, b) {
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    })

  if (jobs.length === 0) return null
  return jobs[0]
}

async function hasDownloadWorkerDocument() {
  try {
    if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      var contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(DOWNLOAD_WORKER_PAGE)],
      })
      if (Array.isArray(contexts) && contexts.length > 0) {
        return true
      }
    }
  } catch (error) {
    void error
  }

  try {
    if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
      return Boolean(await chrome.offscreen.hasDocument())
    }
  } catch (error) {
    void error
  }

  return false
}

async function ensureDownloadWorkerDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') {
    throw new Error('API offscreen indisponivel no navegador. Atualize o Chrome.')
  }

  if (await hasDownloadWorkerDocument()) {
    return
  }

  if (downloadWorkerCreatePromise) {
    await downloadWorkerCreatePromise
    return
  }

  downloadWorkerCreatePromise = chrome.offscreen.createDocument({
    url: DOWNLOAD_WORKER_PAGE,
    reasons: ['BLOBS'],
    justification: 'Manter conversao HLS/DASH/Vimeo em segundo plano quando o popup fechar.',
  }).catch(function(error) {
    var message = error && error.message ? String(error.message) : ''
    if (!message.includes('Only a single offscreen document may be created')) {
      throw error
    }
  }).finally(function() {
    downloadWorkerCreatePromise = null
  })

  await downloadWorkerCreatePromise
}

function sendMessageToDownloadWorker(payload) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage(
      Object.assign({ target: 'download-worker' }, payload),
      function(response) {
        var runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'Falha ao comunicar com o worker em segundo plano.'))
          return
        }
        resolve(response || null)
      }
    )
  })
}

function buildBackgroundJobPayloadFromRecord(record) {
  if (!record || typeof record !== 'object') return null

  return {
    cachedPlaylist: record.cachedPlaylist && typeof record.cachedPlaylist === 'object'
      ? Object.assign({}, record.cachedPlaylist)
      : null,
    candidateUrls: Array.isArray(record.candidateUrls) ? record.candidateUrls.slice(0, 12) : [],
    dedupeKey: String(record.dedupeKey || ''),
    filename: String(record.filename || 'video.mp4'),
    manifestUrl: String(record.manifestUrl || ''),
    mode: String(record.mode || ''),
    mpdUrl: String(record.mpdUrl || ''),
    playlistUrl: String(record.playlistUrl || ''),
    saveFileHandleKey: String(record.saveFileHandleKey || ''),
    selectedUrl: String(record.selectedUrl || record.manifestUrl || record.mpdUrl || record.playlistUrl || ''),
    tabId: typeof record.tabId === 'number' ? record.tabId : -1,
    title: String(record.title || ''),
  }
}

async function startBackgroundConversionDownload(message) {
  var mode = String(message.mode || '')
  var filename = String(message.filename || 'video.mp4')
  var tabId = typeof message.tabId === 'number' ? message.tabId : -1
  var dedupeKey = String(message.dedupeKey || '')
  var title = String(message.title || '')
  var selectedUrl = String(message.selectedUrl || message.manifestUrl || message.mpdUrl || message.playlistUrl || '')
  var saveFileHandleKey = String(message.saveFileHandleKey || '')
  var forcedJobId = String(message.resumeExistingJobId || '')
  var ignoreDedupeChecks = Boolean(message.ignoreDedupeChecks) || Boolean(forcedJobId)

  console.log('[BaixarHSL] pedido de download em segundo plano:', mode || '(sem modo)', selectedUrl.slice(0, 120))

  if (dedupeKey && !ignoreDedupeChecks) {
    var existingJob = findBackgroundJobByDedupeKey(dedupeKey)
    if (existingJob && isBackgroundJobActive(existingJob)) {
      return {
        alreadyRunning: true,
        jobId: String(existingJob.jobId || ''),
        message: 'Este video ja esta em processamento em segundo plano.',
        ok: true,
      }
    }

    if (
      existingJob &&
      existingJob.status === 'completed' &&
      typeof existingJob.updatedAt === 'number' &&
      Date.now() - existingJob.updatedAt < 1000 * 60 * 3
    ) {
      return {
        alreadyCompleted: true,
        jobId: String(existingJob.jobId || ''),
        message: 'Este video foi concluido recentemente. Aguarde alguns instantes antes de iniciar novamente.',
        ok: true,
      }
    }
  }

  var jobId = forcedJobId || createBackgroundJobId()

  var job = {
    dedupeKey: dedupeKey,
    filename: filename,
    jobId: jobId,
    manifestUrl: String(message.manifestUrl || ''),
    mode: mode,
    mpdUrl: String(message.mpdUrl || ''),
    playlistUrl: String(message.playlistUrl || ''),
    saveFileHandleKey: saveFileHandleKey,
    selectedUrl: selectedUrl,
    tabId: tabId,
    title: title,
  }

  if (mode === 'hls' && !job.manifestUrl) {
    throw new Error('Manifesto HLS ausente para download em segundo plano.')
  }
  if (mode === 'dash' && !job.mpdUrl) {
    throw new Error('Manifesto DASH ausente para download em segundo plano.')
  }
  if (mode === 'vimeo-playlist' && !job.playlistUrl) {
    throw new Error('Playlist Vimeo ausente para download em segundo plano.')
  }
  if (mode !== 'hls' && mode !== 'dash' && mode !== 'vimeo-playlist') {
    throw new Error('Modo de conversao invalido para segundo plano.')
  }

  if (mode === 'vimeo-playlist') {
    try {
      job.candidateUrls = await getVimeoPlaylistCandidateUrls(job.playlistUrl, tabId)
    } catch (error) {
      void error
      job.candidateUrls = [job.playlistUrl]
    }

    try {
      var cachedPlaylistEntry = await getCachedVimeoPlaylistBody(job.playlistUrl)
      job.cachedPlaylist = cachedPlaylistEntry
        ? {
            body: String(cachedPlaylistEntry.body || ''),
            sourceUrl: String(cachedPlaylistEntry.sourceUrl || job.playlistUrl || ''),
          }
        : null
    } catch (error) {
      void error
      job.cachedPlaylist = null
    }
  }

  upsertBackgroundDownloadJob(jobId, {
    cachedPlaylist: job.cachedPlaylist || null,
    candidateUrls: Array.isArray(job.candidateUrls) ? job.candidateUrls.slice(0, 12) : [],
    dedupeKey: dedupeKey,
    error: '',
    filename: filename,
    manifestUrl: job.manifestUrl,
    message: 'Enfileirado para processamento em segundo plano.',
    mode: mode,
    mpdUrl: job.mpdUrl,
    percent: 0,
    playlistUrl: job.playlistUrl,
    saveFileHandleKey: saveFileHandleKey,
    selectedUrl: selectedUrl,
    startedAt: Date.now(),
    status: 'queued',
    tabId: tabId,
    title: title,
  })
  trimBackgroundDownloadJobs()

  try {
    await ensureDownloadWorkerDocument()
    var workerResponse = await sendMessageToDownloadWorker({
      action: 'run-background-conversion-job',
      job: job,
    })

    if (!workerResponse || !workerResponse.ok) {
      throw new Error(workerResponse && workerResponse.error
        ? String(workerResponse.error)
        : 'Worker em segundo plano indisponivel.')
    }

    upsertBackgroundDownloadJob(jobId, {
      error: '',
      message: 'Processamento em segundo plano iniciado.',
      percent: 0,
      status: 'running',
    })
    trimBackgroundDownloadJobs()

    console.log('[BaixarHSL] worker de download iniciado:', jobId, mode)

    return {
      jobId: jobId,
      ok: true,
    }
  } catch (error) {
    var errorMessage = error && error.message
      ? String(error.message)
      : 'Falha ao iniciar o worker em segundo plano.'

    upsertBackgroundDownloadJob(jobId, {
      error: errorMessage,
      message: errorMessage,
      percent: null,
      status: 'failed',
    })
    trimBackgroundDownloadJobs()

    console.log('[BaixarHSL] falha ao iniciar worker de download:', jobId, errorMessage)

    throw new Error(errorMessage)
  }
}

async function cancelBackgroundDownloadJob(message) {
  var jobId = String(message.jobId || '')
  if (!jobId) {
    throw new Error('jobId ausente para cancelar o download em segundo plano.')
  }

  var currentJob = backgroundDownloadJobs.get(jobId)
  if (!currentJob) {
    throw new Error('Download em segundo plano nao encontrado para cancelamento.')
  }

  if (currentJob.status === 'completed') {
    return { alreadyCompleted: true, jobId: jobId, message: 'Este download ja foi concluido.', ok: true }
  }
  if (currentJob.status === 'cancelled') {
    return { alreadyCancelled: true, jobId: jobId, message: 'Este download ja foi cancelado.', ok: true }
  }
  if (currentJob.status === 'failed') {
    return { alreadyFailed: true, jobId: jobId, message: 'Este download ja falhou e nao esta em execucao.', ok: true }
  }

  var cancellingMessage = 'Cancelando download em segundo plano...'
  upsertBackgroundDownloadJob(jobId, {
    error: '',
    message: cancellingMessage,
    status: 'cancelling',
  })
  trimBackgroundDownloadJobs()

  await ensureDownloadWorkerDocument()
  var workerResponse = await sendMessageToDownloadWorker({
    action: 'cancel-background-conversion-job',
    jobId: jobId,
  })

  if (!workerResponse || !workerResponse.ok) {
    throw new Error(workerResponse && workerResponse.error
      ? String(workerResponse.error)
      : 'Nao foi possivel enviar o cancelamento para o worker em segundo plano.')
  }

  if (workerResponse.alreadyStopped) {
    var stoppedMessage = workerResponse.message ? String(workerResponse.message) : 'Este download nao estava mais em execucao.'
    upsertBackgroundDownloadJob(jobId, {
      error: '',
      message: stoppedMessage,
      status: currentJob.status === 'completed' ? 'completed' : currentJob.status === 'failed' ? 'failed' : 'cancelled',
    })
    trimBackgroundDownloadJobs()
    return {
      alreadyStopped: true,
      jobId: jobId,
      message: stoppedMessage,
      ok: true,
    }
  }

  return {
    jobId: jobId,
    message: workerResponse.message ? String(workerResponse.message) : cancellingMessage,
    ok: true,
  }
}

async function resumeBackgroundDownloadJob(message) {
  var jobId = String(message.jobId || '')
  if (!jobId) {
    throw new Error('jobId ausente para retomar o download em segundo plano.')
  }

  var currentJob = backgroundDownloadJobs.get(jobId)
  if (!currentJob) {
    throw new Error('Download em segundo plano nao encontrado para retomar.')
  }

  if (isBackgroundJobActive(currentJob)) {
    return {
      alreadyRunning: true,
      jobId: jobId,
      message: 'Este download ja esta em andamento.',
      ok: true,
    }
  }

  var payload = buildBackgroundJobPayloadFromRecord(currentJob)
  if (!payload || !payload.mode) {
    throw new Error('Dados insuficientes para retomar este download em segundo plano.')
  }

  var result = await startBackgroundConversionDownload(Object.assign({}, payload, {
    ignoreDedupeChecks: true,
    resumeExistingJobId: jobId,
  }))

  return {
    alreadyCompleted: Boolean(result && result.alreadyCompleted),
    alreadyRunning: Boolean(result && result.alreadyRunning),
    jobId: result && result.jobId ? String(result.jobId) : jobId,
    message: result && result.message
      ? String(result.message)
      : 'Download retomado em segundo plano.',
    ok: true,
    resumed: true,
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
  } catch {
    return null
  }
}

function normalizeVimeoConfigBody(body) {
  if (typeof body !== 'string') return null
  var trimmed = body.trim()
  if (!trimmed) return null
  var parsed = parseJsonObject(trimmed)
  if (!parsed) return null

  var seemsLikeVimeoConfig = Boolean(
    parsed.video ||
    parsed.clip ||
    parsed.embed ||
    (parsed.request && parsed.request.files)
  )
  if (!seemsLikeVimeoConfig) return null

  return trimmed
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
      // Unifica hosts skyfire/vod-adaptive usando o mesmo caminho canonico da playlist.
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
  return VIMEO_PLAYLIST_KEY_PREFIX + lookupKey
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

async function getVimeoPlaylistCandidateUrls(primaryUrl, tabId) {
  var normalizedPrimary = String(primaryUrl || '').trim()
  if (!isVimeoPlaylistUrl(normalizedPrimary)) return []

  var candidates = []
  var seen = Object.create(null)
  var lookupKey = getVimeoPlaylistLookupKey(primaryUrl)
  if (!lookupKey) return [normalizedPrimary]

  var streams = await new Promise(function(resolve) {
    chrome.storage.local.get(STREAMS_KEY, function(result) {
      resolve(Array.isArray(result && result[STREAMS_KEY]) ? result[STREAMS_KEY] : [])
    })
  })

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

async function getCachedVimeoPlaylistBody(url) {
  var cacheKey = getVimeoPlaylistCacheKey(url)
  if (!cacheKey) return null

  var sessionData = await new Promise(function(resolve) {
    chrome.storage.session.get(cacheKey, function(result) {
      resolve(result || {})
    })
  })

  var cachedEntry = normalizeVimeoPlaylistCacheEntry(sessionData[cacheKey], url)
  if (cachedEntry) return cachedEntry

  if (sessionData[cacheKey]) {
    chrome.storage.session.remove(cacheKey)
    console.log('[BaixarHSL] playlist Vimeo invalida no cache de sessao removida.')
  }

  return null
}

function invalidateResolvedCacheForVimeoPlaylist(url) {
  var lookupKey = getVimeoPlaylistLookupKey(url)
  if (!lookupKey) return

  var prefix = 'vimeo::'
  resolvedCache.forEach(function(_value, cacheKey) {
    if (typeof cacheKey !== 'string' || !cacheKey.startsWith(prefix)) return
    var cachedUrl = cacheKey.slice(prefix.length)
    if (getVimeoPlaylistLookupKey(cachedUrl) !== lookupKey) return
    resolvedCache.delete(cacheKey)
  })
}

function markRecentSavedStream(key) {
  if (!key) return false

  var now = Date.now()
  var previous = recentSavedStreams.get(key)
  if (typeof previous === 'number' && now - previous < 1500) {
    return true
  }

  recentSavedStreams.set(key, now)

  if (recentSavedStreams.size > 500) {
    var minTs = now - 30000
    recentSavedStreams.forEach(function(ts, mapKey) {
      if (typeof ts !== 'number' || ts < minTs) {
        recentSavedStreams.delete(mapKey)
      }
    })
  }

  return false
}

// â”€â”€ DetecÃ§Ã£o de URL de mÃ­dia (resiliente, sem depender do detector) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function detectMediaType(url) {
  var lower = String(url || '').toLowerCase()
  if (!lower.startsWith('http')) return null

  // Fragmentos adaptativos e legendas â€” ignorar completamente
  if (
    lower.includes('/range/') ||
    lower.includes('/segment/') ||
    lower.includes('/avf/') ||
    lower.includes('.m4s') ||
    /[?&]range=/.test(lower) ||
    /[?&]ext-subs=/.test(lower)
  ) return null

  // Manifesto / protocolo vem primeiro â€” mais confiÃ¡vel que extensÃ£o
  if (lower.includes('.m3u8')) return 'hls'
  if (lower.includes('.mpd')) return 'dash'

  // Plataformas brasileiras: verificar antes da extensÃ£o .mp4 porque
  // essas URLs costumam ter .mp4 no caminho mas retornam HLS ou redirect HTML
  if (/pandavideo\.com\.br|pandacdn\.com/i.test(lower)) return 'hls'
  if (/player\.vimeo\.com\/video\/\d+\/config/i.test(lower)) return 'vimeo'
  if (lower.includes('vimeocdn.com') && (lower.includes('playlist.json') || lower.includes('master.json'))) return 'vimeo'
  if (/skyfire\.vimeocdn\.com|vod-adaptive-ak\.vimeocdn\.com/i.test(lower) && (lower.includes('playlist.json') || lower.includes('master.json'))) return 'vimeo'
  if (/hotmart|herospark|eduzz|kiwify|sparkle|estrategia|curseduca/i.test(lower) && lower.includes('manifest')) return 'hls'
  if (/brightcove\.net|bcovlive\.io/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8') || lower.includes('.mpd'))) return 'hls'
  if (/sambatech\.com\.br|sambavideos\.com\.br/i.test(lower)) return 'hls'
  if (/jwpcdn\.com|jwplatform\.com/i.test(lower) && (lower.includes('manifest') || lower.includes('.m3u8'))) return 'hls'
  if (lower.includes('googlevideo.com/videoplayback')) {
    if (/[?&]mime=video(?:%2f|\/)/i.test(lower)) return 'progressive'
    if (/[?&]mime=audio(?:%2f|\/)/i.test(lower)) return null
  }

  // Usa detector se disponÃ­vel (inclui mais padrÃµes)
  if (self.BaixarHSLDetector && typeof self.BaixarHSLDetector.detectStreamFromRequest === 'function') {
    var match = self.BaixarHSLDetector.detectStreamFromRequest(url)
    if (match) return match.type
  }

  // ExtensÃ£o de arquivo de vÃ­deo direto â€” sÃ³ depois de descartar plataformas
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(lower)) return 'progressive'

  return null
}

// â”€â”€ NormalizaÃ§Ã£o de URL para deduplicaÃ§Ã£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function dedupeKeyForUrl(url, type) {
  if (type !== 'vimeo') return url

  // Para URLs de config do Vimeo, ignorar params de rastreio (dnt, app_id)
  // mantendo apenas o param 'h' (token de vÃ­deo privado)
  try {
    var parsed = new URL(url)
    if (/player\.vimeo\.com\/video\/\d+\/config/i.test(parsed.pathname)) {
      var h = parsed.searchParams.get('h')
      return parsed.origin + parsed.pathname + (h ? '?h=' + h : '')
    }
  } catch (ignore) {
    void ignore
  }

  return url
}

// â”€â”€ Salvar stream capturado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function saveStream(url, type, tabId, source) {
  if (!url || !type) return
  var normalizedType = String(type || '')
  var incomingKey = dedupeKeyForUrl(url, normalizedType)
  var recentKey = String(typeof tabId === 'number' ? tabId : -1) + '::' + normalizedType + '::' + incomingKey
  if (markRecentSavedStream(recentKey)) return

  chrome.storage.local.get(STREAMS_KEY, function(r) {
    var streams = Array.isArray(r[STREAMS_KEY]) ? r[STREAMS_KEY] : []

    // Deduplicar - normalizar URLs do Vimeo config antes de comparar
    var exists = streams.some(function(s) {
      return dedupeKeyForUrl(s.url, s.type) === incomingKey
    })
    if (exists) return

    var record = {
      url: url,
      type: type,
      tabId: typeof tabId === 'number' ? tabId : -1,
      source: source || 'background',
      title: '',
      timestamp: Date.now(),
    }

    streams.unshift(record)
    if (streams.length > MAX_STREAMS) streams = streams.slice(0, MAX_STREAMS)

    var payload = {}
    payload[STREAMS_KEY] = streams
    chrome.storage.local.set(payload, function() {
      console.log('[BaixarHSL] stream salvo:', type, url.slice(0, 80))
    })
  })
}

// â”€â”€ DiagnÃ³stico simples â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function logDiag(tabId, kind, url) {
  if (typeof tabId !== 'number' || tabId < 0) return

  chrome.storage.local.get(DIAG_KEY, function(r) {
    var store = r[DIAG_KEY] || {}
    var diagnosticsApi = self.BaixarHSLDiagnostics

    if (diagnosticsApi && typeof diagnosticsApi.ensureDiagnosticsState === 'function' && typeof diagnosticsApi.applyDiagnosticsEvent === 'function') {
      var eventKind = String(kind || 'unknown')
      var streamType = ''

      if (eventKind.indexOf('stream-') === 0) {
        streamType = eventKind.slice('stream-'.length)
        eventKind = 'stream-found'
      } else if (eventKind.indexOf('network-') === 0 && eventKind !== 'network-request' && eventKind !== 'network-response') {
        streamType = eventKind.slice('network-'.length)
        eventKind = 'network-request'
      }

      var currentState = diagnosticsApi.ensureDiagnosticsState(store[tabId], tabId)
      store[tabId] = diagnosticsApi.applyDiagnosticsEvent(currentState, {
        kind: eventKind,
        source: 'background',
        streamType: streamType,
        ts: Date.now(),
        url: String(url || ''),
      })
    } else {
      if (!store[tabId]) store[tabId] = { events: [], tabId: tabId }
      store[tabId].events = (store[tabId].events || []).concat({ kind: kind, source: 'background', url: url, ts: Date.now() }).slice(-100)
    }

    var payload = {}
    payload[DIAG_KEY] = store
    chrome.storage.local.set(payload)
  })
}

// â”€â”€ webRequest: intercepta requisiÃ§Ãµes de rede â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function inferVimeoPlaylistStreamUrl(url) {
  var detectorApi = self.BaixarHSLDetector
  if (!detectorApi || typeof detectorApi.inferVimeoPlaylistFromRangeUrl !== 'function') return ''
  var inferred = detectorApi.inferVimeoPlaylistFromRangeUrl(url)
  return inferred ? String(inferred) : ''
}

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    var inferredPlaylistUrl = inferVimeoPlaylistStreamUrl(details.url)
    if (inferredPlaylistUrl) {
      saveStream(inferredPlaylistUrl, 'vimeo', details.tabId, 'webRequest-inferred')
      logDiag(details.tabId, 'network-vimeo', inferredPlaylistUrl)
      return
    }

    var type = detectMediaType(details.url)
    if (!type) return
    saveStream(details.url, type, details.tabId, 'webRequest')
    logDiag(details.tabId, 'network-' + type, details.url)
  },
  { urls: ['<all_urls>'] }
)

// TambÃ©m inspeciona headers de resposta (captura por Content-Type)
chrome.webRequest.onHeadersReceived.addListener(
  function(details) {
    var url = details.url || ''
    var inferredPlaylistUrl = inferVimeoPlaylistStreamUrl(url)
    if (inferredPlaylistUrl) {
      saveStream(inferredPlaylistUrl, 'vimeo', details.tabId, 'headers-inferred')
      return
    }

    var lower = url.toLowerCase()

    // Ignorar fragmentos adaptativos e legendas â€” nunca salvar como stream
    if (
      lower.includes('/range/') ||
      lower.includes('/segment/') ||
      lower.includes('/avf/') ||
      lower.includes('.m4s') ||
      /[?&]range=/.test(lower) ||
      /[?&]ext-subs=/.test(lower)
    ) return

    var ct = ''
    if (Array.isArray(details.responseHeaders)) {
      for (var i = 0; i < details.responseHeaders.length; i++) {
        var h = details.responseHeaders[i]
        if (h && h.name && h.name.toLowerCase() === 'content-type') {
          ct = String(h.value || '').toLowerCase()
          break
        }
      }
    }

    var type = null
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) {
      // Verificar se Ã© playlist Vimeo antes de classificar como HLS
      if (lower.includes('vimeocdn.com') && (lower.includes('playlist.json') || lower.includes('master.json'))) {
        type = 'vimeo'
      } else {
        type = 'hls'
      }
    } else if (ct.includes('dash') || ct.includes('mpd')) {
      type = 'dash'
    } else if (ct.includes('video/mp4') || ct.includes('video/webm')) {
      // NÃ£o salvar como progressive se for URL de CDN adaptativo sem ser download direto
      if (lower.includes('vimeocdn.com')) return
      type = 'progressive'
    }

    if (!type) return
    saveStream(url, type, details.tabId, 'headers')
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

// â”€â”€ Mensagens do content script â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return false

  if (message.target === 'download-worker') {
    return false
  }

  if (message.action === 'background-download-status' && message.target === 'background') {
    var backgroundJobId = String(message.jobId || '')
    if (backgroundJobId) {
      upsertBackgroundDownloadJob(backgroundJobId, {
        error: message.error ? String(message.error) : '',
        message: message.message ? String(message.message) : '',
        percent: typeof message.percent === 'number' ? message.percent : null,
        status: String(message.status || 'running'),
      })
      trimBackgroundDownloadJobs()
    }
    sendResponse({ ok: true })
    return false
  }

  // Stream capturado pelo interceptor da pÃ¡gina
  if (message.action === 'capture-stream') {
    var senderTabId = sender && sender.tab ? sender.tab.id : -1
    var stream = message.stream || {}
    if (stream.url) {
      saveStream(stream.url, stream.type || 'hls', senderTabId, stream.source || 'content')
      logDiag(senderTabId, 'stream-' + (stream.type || 'hls'), stream.url)
    }
    sendResponse({ ok: true })
    return false
  }
  if (message.action === 'debug-event') {
    var diagnosticsApi = self.BaixarHSLDiagnostics
    var incomingEvent = message.event && typeof message.event === 'object' ? message.event : {}
    var senderTabIdForEvent = sender && sender.tab ? sender.tab.id : -1
    var eventTabId = typeof incomingEvent.tabId === 'number' ? incomingEvent.tabId : senderTabIdForEvent
    if (typeof eventTabId !== 'number' || eventTabId < 0) {
      sendResponse({ ok: false, error: 'tabId ausente para debug-event' })
      return false
    }

    chrome.storage.local.get(DIAG_KEY, function(r) {
      var store = r[DIAG_KEY] || {}
      if (
        diagnosticsApi &&
        typeof diagnosticsApi.ensureDiagnosticsState === 'function' &&
        typeof diagnosticsApi.applyDiagnosticsEvent === 'function'
      ) {
        var currentState = diagnosticsApi.ensureDiagnosticsState(store[eventTabId], eventTabId)
        var normalizedEvent = Object.assign({}, incomingEvent, {
          ts: Number(incomingEvent.ts || Date.now()),
        })
        store[eventTabId] = diagnosticsApi.applyDiagnosticsEvent(currentState, normalizedEvent)
      } else {
        if (!store[eventTabId]) store[eventTabId] = { events: [], tabId: eventTabId }
        store[eventTabId].events = (store[eventTabId].events || []).concat({
          kind: String(incomingEvent.kind || 'debug-event'),
          source: String(incomingEvent.source || 'content'),
          ts: Date.now(),
          url: String(incomingEvent.url || ''),
        }).slice(-100)
      }

      var payload = {}
      payload[DIAG_KEY] = store
      chrome.storage.local.set(payload, function() {
        sendResponse({ ok: true })
      })
    })
    return true
  }

  // Cache de body do config Vimeo interceptado na pÃ¡gina
  if (message.action === 'cache-vimeo-config') {
    if (message.url && message.body) {
      var normalizedConfigBody = normalizeVimeoConfigBody(message.body)
      if (normalizedConfigBody) {
        var vcKey = VIMEO_CFG_KEY_PREFIX + dedupeKeyForUrl(message.url, 'vimeo')
        var vcPayload = {}
        vcPayload[vcKey] = normalizedConfigBody
        chrome.storage.session.set(vcPayload)
        console.log('[BaixarHSL] config Vimeo cacheado:', message.url.slice(0, 80), 'bytes:', normalizedConfigBody.length)
        // Invalidar cache de resolucao para forcar re-resolucao com o body cacheado
        var resolveKey = 'vimeo::' + message.url
        resolvedCache.delete(resolveKey)
      } else {
        console.log('[BaixarHSL] config Vimeo ignorado (conteudo nao JSON):', String(message.url).slice(0, 80))
      }
    }
    sendResponse({ ok: true })
    return false
  }

  // Cache de body do playlist Vimeo interceptado na pagina
  if (message.action === 'cache-vimeo-playlist') {
    if (message.url && message.body) {
      var normalizedPlaylistBody = normalizeVimeoPlaylistBody(message.body)
      if (normalizedPlaylistBody) {
        var playlistCacheKey = getVimeoPlaylistCacheKey(message.url)
        if (playlistCacheKey) {
          var playlistPayload = {}
          playlistPayload[playlistCacheKey] = {
            body: normalizedPlaylistBody,
            cachedAt: Date.now(),
            sourceUrl: String(message.url || ''),
          }
          chrome.storage.session.set(playlistPayload)
          console.log('[BaixarHSL] playlist Vimeo cacheada:', String(message.url).slice(0, 80), 'bytes:', normalizedPlaylistBody.length)
          invalidateResolvedCacheForVimeoPlaylist(message.url)
        }
      } else {
        console.log('[BaixarHSL] playlist Vimeo ignorada (conteudo invalido):', String(message.url).slice(0, 80))
      }
    }
    sendResponse({ ok: true })
    return false
  }

  // Resolver detalhes de manifesto HLS/Vimeo
  if (message.action === 'resolveStreamDetails') {
    resolveStreamDetails(message.stream || {})
      .then(function(details) { sendResponse({ ok: true, details: details }) })
      .catch(function(e) { sendResponse({ ok: false, error: e && e.message || 'Erro' }) })
    return true
  }

  // Download direto (progressive) â€” com preflight para detectar HTML
  if (message.action === 'downloadResolvedStream') {
    var dlUrl = message.url ? String(message.url) : ''
    if (!dlUrl) { sendResponse({ ok: false, error: 'URL ausente' }); return false }

    fetch(dlUrl, { method: 'HEAD', credentials: 'include', cache: 'no-store' })
      .then(function(r) {
        var ct = (r.headers.get('content-type') || '').toLowerCase()
        if (ct.includes('text/html') || ct.includes('application/xhtml')) {
          sendResponse({ ok: false, error: 'O servidor retornou uma pagina HTML (token expirado ou login necessario). Tente recarregar a pagina do video e clique em Atualizar.' })
          return
        }
        chrome.downloads.download({
          url: dlUrl,
          filename: String(message.filename || 'video.mp4'),
          saveAs: true,
        }, function(id) {
          var err = chrome.runtime.lastError
          if (err) { sendResponse({ ok: false, error: err.message }); return }
          sendResponse({ ok: true, downloadId: id })
        })
      })
      .catch(function() {
        // HEAD falhou (CORS, rede) â€” tenta download direto assim mesmo
        chrome.downloads.download({
          url: dlUrl,
          filename: String(message.filename || 'video.mp4'),
          saveAs: true,
        }, function(id) {
          var err = chrome.runtime.lastError
          if (err) { sendResponse({ ok: false, error: err.message }); return }
          sendResponse({ ok: true, downloadId: id })
        })
      })
    return true
  }

  // Conversao HLS/DASH/Vimeo em segundo plano (continua mesmo com popup fechado)
  if (message.action === 'startBackgroundConversionDownload') {
    startBackgroundConversionDownload(message)
      .then(function(result) {
        sendResponse(result)
      })
      .catch(function(error) {
        console.error('[BaixarHSL] falha ao iniciar processamento em segundo plano:', error)
        sendResponse({
          error: error && error.message
            ? String(error.message)
            : 'Falha ao iniciar a conversao em segundo plano.',
          ok: false,
        })
      })
    return true
  }

  if (message.action === 'cancelBackgroundDownloadJob') {
    cancelBackgroundDownloadJob(message)
      .then(function(result) {
        sendResponse(result)
      })
      .catch(function(error) {
        sendResponse({
          error: error && error.message
            ? String(error.message)
            : 'Falha ao cancelar o processamento em segundo plano.',
          ok: false,
        })
      })
    return true
  }

  if (message.action === 'resumeBackgroundDownloadJob') {
    resumeBackgroundDownloadJob(message)
      .then(function(result) {
        sendResponse(result)
      })
      .catch(function(error) {
        sendResponse({
          error: error && error.message
            ? String(error.message)
            : 'Falha ao retomar o processamento em segundo plano.',
          ok: false,
        })
      })
    return true
  }

  if (message.action === 'getBackgroundDownloadJob') {
    var requestedJobId = String(message.jobId || '')
    if (!requestedJobId) {
      var orderedJobs = Array.from(backgroundDownloadJobs.values()).sort(function(a, b) {
        return Number(b && b.updatedAt || 0) - Number(a && a.updatedAt || 0)
      })
      sendResponse({
        jobs: orderedJobs,
        ok: true,
      })
      return false
    }

    sendResponse({
      job: backgroundDownloadJobs.get(requestedJobId) || null,
      ok: true,
    })
    return false
  }

  // Debug ping
  if (message.action === 'ping') {
    sendResponse({ ok: true, now: Date.now() })
    return false
  }

  // Estado de diagnÃ³stico
  if (message.action === 'getDebugState') {
    chrome.storage.local.get([DIAG_KEY, STREAMS_KEY], function(r) {
      var diagnosticsApi = self.BaixarHSLDiagnostics
      var store = r[DIAG_KEY] || {}
      var tabId = typeof message.tabId === 'number' ? message.tabId : -1
      var tabState = store[tabId] || { events: [] }
      var report = ''

      if (
        diagnosticsApi &&
        typeof diagnosticsApi.ensureDiagnosticsState === 'function' &&
        typeof diagnosticsApi.formatDiagnosticsReport === 'function'
      ) {
        tabState = diagnosticsApi.ensureDiagnosticsState(tabState, tabId)
        report = diagnosticsApi.formatDiagnosticsReport(tabState, {
          backgroundResponsive: true,
          pageTitle: String(message.pageTitle || ''),
          pageUrl: String(message.pageUrl || ''),
        })
      }

      sendResponse({
        ok: true,
        report: report,
        state: tabState,
        totalStreams: (r[STREAMS_KEY] || []).length,
      })
    })
    return true
  }

  if (message.action === 'clearDebugState') {
    chrome.storage.local.get(DIAG_KEY, function(r) {
      var store = r[DIAG_KEY] || {}
      delete store[message.tabId]
      var payload = {}
      payload[DIAG_KEY] = store
      chrome.storage.local.set(payload, function() { sendResponse({ ok: true }) })
    })
    return true
  }

  return false
})

// Limpar diagnÃ³stico quando aba fecha
chrome.tabs.onRemoved.addListener(function(tabId) {
  chrome.storage.local.get(DIAG_KEY, function(r) {
    var store = r[DIAG_KEY] || {}
    if (!store[tabId]) return
    delete store[tabId]
    var payload = {}
    payload[DIAG_KEY] = store
    chrome.storage.local.set(payload)
  })
})

// â”€â”€ Resolver detalhes de manifesto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseResolutionFromText(value) {
  var match = String(value || '').match(/(\d{3,4})/)
  if (!match) return 0

  var parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function getYouTubeItagHeight(itag) {
  var map = {
    '17': 144,
    '18': 360,
    '22': 720,
    '37': 1080,
    '38': 2160,
    '59': 480,
    '78': 360,
  }

  return map[String(itag || '')] || 0
}

function buildDirectDownloadOption(stream) {
  var option = {
    label: 'Download direto',
    quality: 'Original',
    type: stream.type || 'progressive',
    url: stream.url,
  }

  try {
    var parsed = new URL(String(stream.url || ''))
    var qualityLabel = String(parsed.searchParams.get('quality_label') || '').trim()
    var qualityParam = String(parsed.searchParams.get('quality') || '').trim()
    var itag = String(parsed.searchParams.get('itag') || '').trim()

    var height = 0
    if (qualityLabel) {
      height = parseResolutionFromText(qualityLabel)
    }
    if (!height && qualityParam) {
      height = parseResolutionFromText(qualityParam)
      if (!height) {
        var qualityMatch = qualityParam.match(/hd(\d{3,4})/)
        if (qualityMatch) {
          height = Number.parseInt(qualityMatch[1], 10)
        }
      }
    }
    if (!height && itag) {
      height = getYouTubeItagHeight(itag)
    }

    if (height > 0) {
      option.height = height
      option.quality = String(height) + 'p'
      option.label = 'Download direto (' + option.quality + ')'
      return option
    }

    if (qualityLabel) {
      option.quality = qualityLabel
      option.label = 'Download direto (' + qualityLabel + ')'
    } else if (qualityParam) {
      option.quality = qualityParam
      option.label = 'Download direto (' + qualityParam + ')'
    }
  } catch (error) {
    void error
  }

  return option
}
async function resolveStreamDetails(stream) {
  if (!stream || !stream.url) throw new Error('Nenhum stream para resolver.')

  var cacheKey = stream.type + '::' + stream.url
  if (resolvedCache.has(cacheKey)) return resolvedCache.get(cacheKey)

  var promise = (async function() {
    if (stream.type === 'hls') {
      var hlsApi = self.BaixarHSLHls
      if (!hlsApi) throw new Error('MÃ³dulo HLS nÃ£o carregado.')
      var resp = await fetch(stream.url, { credentials: 'include', cache: 'no-store' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      var text = await resp.text()
      var parsed = hlsApi.resolvePlaylist(text, stream.url)

      if (parsed.kind === 'master' && parsed.variants.length > 0) {
        return {
          canDownloadHls: true,
          isDrmProtected: false,
          options: parsed.variants,
          selectedType: 'hls',
          selectedUrl: parsed.variants[0].url,
          title: stream.title || '',
          thumbnailUrl: stream.thumbnailUrl || '',
          filename: (stream.title || 'video') + '.mp4',
        }
      }

      return {
        canDownloadHls: true,
        isDrmProtected: false,
        options: [{ label: 'Original (HLS)', quality: 'Original', type: 'hls', url: stream.url }],
        selectedType: 'hls',
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    if (stream.type === 'dash') {
      return {
        canDownloadDash: true,
        isDrmProtected: false,
        options: [{ label: 'DASH (MPD)', quality: 'Original', type: 'dash', url: stream.url }],
        selectedType: 'dash',
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    if (stream.type === 'vimeo') {
      var vimeoUrlLower = stream.url.toLowerCase()

      // playlist.json / master.json â†’ segmented Vimeo playlist parser
      // Don't try to use config parser as fallback for playlist.json
      if (vimeoUrlLower.includes('playlist.json') || vimeoUrlLower.includes('master.json')) {
        if (!self.BaixarHSLVimeoPlaylist) return null

        var playlistCandidates = await getVimeoPlaylistCandidateUrls(stream.url, stream.tabId)
        if (playlistCandidates.length === 0) playlistCandidates = [stream.url]

        for (var playlistIndex = 0; playlistIndex < playlistCandidates.length; playlistIndex += 1) {
          var playlistUrl = playlistCandidates[playlistIndex]
          var cachedPlaylist = await getCachedVimeoPlaylistBody(playlistUrl)
          var normalizedPlaylistText = cachedPlaylist ? cachedPlaylist.body : null
          var playlistBaseUrl = cachedPlaylist && cachedPlaylist.sourceUrl ? cachedPlaylist.sourceUrl : playlistUrl

          if (!normalizedPlaylistText) {
            try {
              var playlistResp = await fetch(playlistUrl, { credentials: 'include', cache: 'no-store' })
              if (!playlistResp.ok) {
                console.log('[BaixarHSL] playlist Vimeo fetch falhou HTTP', playlistResp.status, String(playlistUrl).slice(0, 80))
                continue
              }

              var playlistText = await playlistResp.text()
              normalizedPlaylistText = normalizeVimeoPlaylistBody(playlistText)
              if (!normalizedPlaylistText) {
                console.log('[BaixarHSL] playlist Vimeo fetch retornou conteudo invalido:', String(playlistUrl).slice(0, 80))
                continue
              }

              var playlistCacheKey = getVimeoPlaylistCacheKey(playlistUrl)
              if (playlistCacheKey) {
                var playlistPayload = {}
                playlistPayload[playlistCacheKey] = {
                  body: normalizedPlaylistText,
                  cachedAt: Date.now(),
                  sourceUrl: playlistUrl,
                }
                chrome.storage.session.set(playlistPayload)
              }
            } catch (playlistFetchError) {
              console.log('[BaixarHSL] playlist Vimeo fetch erro:', playlistFetchError && playlistFetchError.message)
              continue
            }
          }

          var playlistDetails = self.BaixarHSLVimeoPlaylist.resolvePlaylistDetails(normalizedPlaylistText, playlistBaseUrl)
          if (!playlistDetails || !Array.isArray(playlistDetails.options) || playlistDetails.options.length === 0) {
            continue
          }

          // Keep popup payload small: worker resolves full track segment lists again when download starts.
          var lightweightOptions = playlistDetails.options.map(function(option) {
            return {
              bitrate: option && typeof option.bitrate === 'number' ? option.bitrate : null,
              height: option && typeof option.height === 'number' ? option.height : null,
              label: option && option.label ? String(option.label) : 'Vimeo',
              playlistUrl: option && option.playlistUrl ? String(option.playlistUrl) : String(playlistBaseUrl || ''),
              quality: option && option.quality ? String(option.quality) : 'Original',
              type: 'vimeo-playlist',
              url: option && option.url ? String(option.url) : String(playlistBaseUrl || ''),
              width: option && typeof option.width === 'number' ? option.width : null,
            }
          })
          var selectedPlaylistOption = lightweightOptions[0]
          if (playlistDetails.selectedUrl) {
            var selectedCandidate = lightweightOptions.find(function(option) {
              return option && option.url === playlistDetails.selectedUrl
            })
            if (selectedCandidate) selectedPlaylistOption = selectedCandidate
          }

          console.log(
            '[BaixarHSL] playlist Vimeo resolvida:',
            String(playlistBaseUrl).slice(0, 80),
            'opcoes:',
            playlistDetails.options.length
          )

          return {
            canDownloadVimeoPlaylist: true,
            canDownloadDirect: false,
            canDownloadHls: false,
            canDownloadDash: false,
            isDrmProtected: false,
            options: lightweightOptions,
            selectedType: 'vimeo-playlist',
            selectedUrl: selectedPlaylistOption ? selectedPlaylistOption.url : String(playlistBaseUrl || ''),
            title: stream.title || '',
            thumbnailUrl: stream.thumbnailUrl || '',
            filename: (stream.title || 'video') + '.mp4',
          }
        }

        return null
      }

      // /config â†’ try fetching from within the page's iframe (correct Referer) first,
      // then fall back to session cache, then direct SW fetch
      var vimeoText = null

      // 1. Try scripting.executeScript in the Vimeo player iframe (same-origin, correct Referer)
      var scriptingTabId = typeof stream.tabId === 'number' && stream.tabId > 0 ? stream.tabId : -1
      if (scriptingTabId > 0 && chrome.scripting && chrome.scripting.executeScript) {
        try {
          var scriptUrl = stream.url
          var scriptResults = await chrome.scripting.executeScript({
            target: { tabId: scriptingTabId, allFrames: true },
            world: 'MAIN',
            func: function(configUrl) {
              if (typeof window === 'undefined') return null
              var host = window.location.hostname || ''
              if (host !== 'player.vimeo.com') return null
              return fetch(configUrl, { credentials: 'include', cache: 'no-store' })
                .then(function(r) { return r.ok ? r.text() : null })
                .catch(function() { return null })
            },
            args: [scriptUrl],
          })
          if (Array.isArray(scriptResults)) {
            for (var si = 0; si < scriptResults.length; si++) {
              var sr = scriptResults[si]
              if (!sr || !sr.result || typeof sr.result !== 'string' || sr.result.length <= 10) continue
              var normalizedScriptConfig = normalizeVimeoConfigBody(sr.result)
              if (!normalizedScriptConfig) {
                console.log('[BaixarHSL] config Vimeo via scripting ignorado (conteudo nao JSON).')
                continue
              }
              vimeoText = normalizedScriptConfig
              console.log('[BaixarHSL] config Vimeo via scripting, bytes:', vimeoText.length)
              break
            }
          }
        } catch (scriptErr) {
          console.log('[BaixarHSL] scripting.executeScript falhou:', scriptErr && scriptErr.message)
        }
      }

      // 2. Fall back to session-cached body from interceptor
      if (!vimeoText) {
        var configStorageKey = VIMEO_CFG_KEY_PREFIX + dedupeKeyForUrl(stream.url, 'vimeo')
        var sessionData = await new Promise(function(resolve) {
          chrome.storage.session.get(configStorageKey, function(r) { resolve(r || {}) })
        })
        var cachedConfig = normalizeVimeoConfigBody(sessionData[configStorageKey] || '')
        if (cachedConfig) {
          vimeoText = cachedConfig
          console.log('[BaixarHSL] config Vimeo do cache de sessao, bytes:', vimeoText.length)
        } else if (sessionData[configStorageKey]) {
          chrome.storage.session.remove(configStorageKey)
          console.log('[BaixarHSL] config Vimeo invalido no cache de sessao removido.')
        }
      }

      // 3. Fall back to direct SW fetch (may fail if domain-restricted)
      if (!vimeoText) {
        try {
          var vimeoResp = await fetch(stream.url, { credentials: 'include', cache: 'no-store' })
          if (vimeoResp.ok) {
            var directConfigText = await vimeoResp.text()
            var normalizedDirectConfig = normalizeVimeoConfigBody(directConfigText)
            if (normalizedDirectConfig) {
              vimeoText = normalizedDirectConfig
              console.log('[BaixarHSL] config Vimeo via fetch direto, bytes:', vimeoText.length)
            } else {
              console.log('[BaixarHSL] config Vimeo fetch direto retornou conteudo nao JSON.')
            }
          } else {
            console.log('[BaixarHSL] config Vimeo fetch direto falhou HTTP', vimeoResp.status)
          }
        } catch (fetchErr) {
          console.log('[BaixarHSL] config Vimeo fetch erro:', fetchErr && fetchErr.message)
        }
      }

      // /config -> Vimeo player config parser
      if (vimeoText && self.BaixarHSLStreamDetails) {
        var details = self.BaixarHSLStreamDetails.resolveVimeoStreamDetails(vimeoText, stream.url)
        details.title = details.title || stream.title || ''
        details.thumbnailUrl = details.thumbnailUrl || stream.thumbnailUrl || ''
        details.filename = (details.title || 'video') + '.mp4'
        return details
      }

      // Config not available â€” cannot resolve this Vimeo stream
      return null
    }

    // DRM / MediaSource â€” nÃ£o tem download direto
    if (stream.type === 'drm' || stream.type === 'media-source') {
      return {
        isDrmProtected: stream.type === 'drm',
        blockReason: stream.type === 'drm'
          ? 'Conteudo protegido por DRM. A extensao nao pode baixar esse stream.'
          : 'Player com MediaSource detectado. Nao ha URL direta para download.',
        options: [],
        selectedType: stream.type,
        selectedUrl: stream.url,
        title: stream.title || '',
        thumbnailUrl: stream.thumbnailUrl || '',
        filename: (stream.title || 'video') + '.mp4',
      }
    }

    // Progressive â€” URL de arquivo de video direto
    var directOption = buildDirectDownloadOption(stream)
    return {
      canDownloadDirect: true,
      isDrmProtected: false,
      options: [directOption],
      selectedType: stream.type || 'progressive',
      selectedUrl: stream.url,
      title: stream.title || '',
      thumbnailUrl: stream.thumbnailUrl || '',
      filename: (stream.title || 'video') + '.mp4',
    }
  })().catch(function(e) {
    resolvedCache.delete(cacheKey)
    throw e
  })

  resolvedCache.set(cacheKey, promise)
  return promise
}

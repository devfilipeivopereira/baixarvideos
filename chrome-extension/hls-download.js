;(function(root) {
  var ffmpegInstance = null
  var ffmpegLoadPromise = null

  function ensureApi(name, value) {
    if (!value) {
      throw new Error(name + ' nao esta disponivel nesta extensao.')
    }

    return value
  }

  function isCancellationRequested(shouldCancel) {
    if (typeof shouldCancel !== 'function') return false
    try {
      return Boolean(shouldCancel())
    } catch {
      return false
    }
  }

  function throwIfCancelled(shouldCancel) {
    if (!isCancellationRequested(shouldCancel)) return
    throw new Error('Download cancelado pelo usuario.')
  }

  function arrayBufferFromUint8Array(data) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }

  function buildSegmentFilename(index) {
    return 'seg' + String(index).padStart(5, '0') + '.ts'
  }

  function buildConcatList(filenames) {
    return filenames.map(function(filename) {
      return "file '" + filename + "'"
    }).join('\n')
  }

  function isVimeoCdnUrl(url) {
    try {
      var host = new URL(String(url || '')).hostname.toLowerCase()
      return host === 'vimeocdn.com' || host.endsWith('.vimeocdn.com')
    } catch {
      return false
    }
  }

  function buildFetchOptions(url, extraHeaders) {
    var options = {
      cache: 'no-store',
      credentials: 'include',
    }

    if (extraHeaders) {
      options.headers = extraHeaders
    }

    // Vimeo range/prot and avf segments require a player.vimeo.com referrer.
    if (isVimeoCdnUrl(url)) {
      options.referrer = 'https://player.vimeo.com/'
      options.referrerPolicy = 'strict-origin-when-cross-origin'
    }

    return options
  }

  async function fetchBytesFromVimeoPlayerFrame(url, tabId) {
    if (!root.chrome || !root.chrome.scripting || typeof root.chrome.scripting.executeScript !== 'function') {
      return null
    }

    if (typeof tabId !== 'number' || tabId <= 0) {
      return null
    }

    try {
      var scriptResults = await root.chrome.scripting.executeScript({
        target: {
          allFrames: true,
          tabId: tabId,
        },
        world: 'MAIN',
        func: function(segmentUrl) {
          if (typeof window === 'undefined') return null
          if (window.location.hostname !== 'player.vimeo.com') return null

          return fetch(segmentUrl, {
            cache: 'no-store',
            credentials: 'include',
            referrer: window.location.href,
            referrerPolicy: 'strict-origin-when-cross-origin',
          })
            .then(function(response) {
              if (!response.ok) return null
              return response.arrayBuffer()
            })
            .then(function(buffer) {
              if (!buffer) return null
              return Array.from(new Uint8Array(buffer))
            })
            .catch(function() {
              return null
            })
        },
        args: [url],
      })

      if (!Array.isArray(scriptResults)) return null

      for (var index = 0; index < scriptResults.length; index += 1) {
        var entry = scriptResults[index]
        if (!entry || !Array.isArray(entry.result) || entry.result.length === 0) continue
        return new Uint8Array(entry.result)
      }
    } catch (error) {
      console.log('[BaixarHSL] fallback de segmento Vimeo via frame falhou:', error && error.message)
    }

    return null
  }

  async function fetchText(url) {
    var response = await fetch(url, buildFetchOptions(url))

    if (!response.ok) {
      throw new Error(
        'Falha ao buscar manifesto: HTTP ' + response.status +
        ' → ' + String(url).slice(0, 150)
      )
    }

    return response.text()
  }

  async function fetchBytes(url, extraHeaders, context) {
    var response = await fetch(url, buildFetchOptions(url, extraHeaders))

    if (!response.ok) {
      if (response.status === 403 && isVimeoCdnUrl(url)) {
        var frameBytes = await fetchBytesFromVimeoPlayerFrame(
          url,
          context && typeof context.tabId === 'number' ? context.tabId : -1
        )
        if (frameBytes && frameBytes.length > 0) {
          console.log('[BaixarHSL] segmento Vimeo baixado via fallback do frame player.vimeo.com')
          return frameBytes
        }
      }

      throw new Error(
        'Falha ao baixar segmento: HTTP ' + response.status +
        ' -> ' + String(url).slice(0, 150)
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  function concatUint8Arrays(chunks) {
    var totalLength = chunks.reduce(function(sum, chunk) {
      return sum + (chunk ? chunk.length : 0)
    }, 0)
    var combined = new Uint8Array(totalLength)
    var offset = 0

    for (var i = 0; i < chunks.length; i += 1) {
      var chunk = chunks[i]
      if (!chunk || !chunk.length) continue
      combined.set(chunk, offset)
      offset += chunk.length
    }

    return combined
  }

  function looksLikeUrl(value) {
    if (!value) return false

    return (
      /^https?:\/\//i.test(value) ||
      /^\//.test(value) ||
      value.includes('.mp4') ||
      value.includes('.m4s') ||
      value.includes('?')
    )
  }

  function decodeBase64ToBytes(value) {
    var normalized = String(value || '').replace(/\s+/g, '')
    var binary = globalThis.atob(normalized)
    var bytes = new Uint8Array(binary.length)

    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  }

  async function ensureFfmpeg() {
    if (ffmpegInstance) return ffmpegInstance
    if (ffmpegLoadPromise) return ffmpegLoadPromise

    var ffmpegGlobal = ensureApi('FFmpegWASM', root.FFmpegWASM)
    var FFmpeg = ensureApi('FFmpeg', ffmpegGlobal.FFmpeg)
    var ffmpeg = new FFmpeg()

    ffmpegLoadPromise = ffmpeg.load({
      coreURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.wasm'),
    }).then(function() {
      ffmpegInstance = ffmpeg
      return ffmpeg
    }).catch(function(error) {
      ffmpegLoadPromise = null
      throw error
    })

    return ffmpegLoadPromise
  }

  async function resolveMediaManifest(manifestUrl) {
    var hlsApi = ensureApi('BaixarHSLHls', root.BaixarHSLHls)
    var manifestText = await fetchText(manifestUrl)
    var parsed = hlsApi.resolvePlaylist(manifestText, manifestUrl)

    if (parsed.kind === 'master') {
      if (!parsed.variants || !parsed.variants[0] || !parsed.variants[0].url) {
        throw new Error('Manifesto HLS mestre sem variantes utilizaveis.')
      }

      return resolveMediaManifest(parsed.variants[0].url)
    }

    return {
      manifestText: manifestText,
      manifestUrl: manifestUrl,
    }
  }

  async function writeMediaResources(ffmpeg, workDir, resources, onStatus, context, shouldCancel) {
    for (var index = 0; index < resources.length; index += 1) {
      throwIfCancelled(shouldCancel)
      var resource = resources[index]
      var percent = resources.length > 0
        ? Math.round((index / resources.length) * 60)
        : 0

      if (onStatus) {
        onStatus(percent, 'Baixando segmentos ' + (index + 1) + '/' + resources.length + '...')
      }

      var bytes = await fetchBytes(resource.url, null, context)
      throwIfCancelled(shouldCancel)
      await ffmpeg.writeFile(workDir + '/' + resource.filename, bytes)
    }
  }

  async function runFfmpegPipeline(ffmpeg, inputPath, outputPath, shouldCancel) {
    throwIfCancelled(shouldCancel)
    var exitCode = await ffmpeg.exec([
      '-protocol_whitelist',
      'file,crypto,data',
      '-allowed_extensions',
      'ALL',
      '-i',
      inputPath,
      '-c',
      'copy',
      '-bsf:a',
      'aac_adtstoasc',
      outputPath,
    ])

    throwIfCancelled(shouldCancel)
    if (exitCode === 0) return

    try {
      await ffmpeg.deleteFile(outputPath)
    } catch (error) {
      void error
    }

    throwIfCancelled(shouldCancel)
    exitCode = await ffmpeg.exec([
      '-protocol_whitelist',
      'file,crypto,data',
      '-allowed_extensions',
      'ALL',
      '-i',
      inputPath,
      '-c',
      'copy',
      outputPath,
    ])

    throwIfCancelled(shouldCancel)
    if (exitCode !== 0) {
      throw new Error('Falha ao converter o stream HLS para MP4.')
    }
  }

  async function runMuxPipeline(ffmpeg, videoPath, audioPath, outputPath, shouldCancel) {
    throwIfCancelled(shouldCancel)
    var command = ['-i', videoPath]

    if (audioPath) {
      command = command.concat([
        '-i',
        audioPath,
        '-c',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        outputPath,
      ])
    } else {
      command = command.concat([
        '-c',
        'copy',
        outputPath,
      ])
    }

    var exitCode = await ffmpeg.exec(command)
    throwIfCancelled(shouldCancel)
    if (exitCode !== 0) {
      throw new Error('Falha ao montar o MP4 final do Vimeo.')
    }
  }

  async function resolveTrackInitBytes(track, context) {
    if (!track || !track.initSegment) return new Uint8Array(0)

    var rawValue = String(track.initSegment).trim()
    if (!rawValue) return new Uint8Array(0)

    if (looksLikeUrl(rawValue)) {
      var initUrl = new URL(rawValue, track.baseUrl || undefined).href
      return fetchBytes(initUrl, null, context)
    }

    try {
      return decodeBase64ToBytes(rawValue)
    } catch {
      if (track.baseUrl) {
        try {
          return fetchBytes(new URL(rawValue, track.baseUrl).href, null, context)
        } catch (urlError) {
          void urlError
        }
      }

      throw new Error('Falha ao decodificar o segmento inicial do Vimeo.')
    }
  }

  async function buildTrackBytes(track, statusPrefix, progressStart, progressSpan, onStatus, context, shouldCancel) {
    if (!track || !Array.isArray(track.segments) || track.segments.length === 0) {
      throw new Error('Faixa segmentada do Vimeo sem segmentos utilizaveis.')
    }

    var chunks = []
    var initBytes = await resolveTrackInitBytes(track, context)
    if (initBytes.length) {
      chunks.push(initBytes)
    }

    for (var index = 0; index < track.segments.length; index += 1) {
      throwIfCancelled(shouldCancel)
      if (onStatus) {
        var ratio = track.segments.length > 0 ? index / track.segments.length : 0
        onStatus(
          progressStart + Math.round(ratio * progressSpan),
          statusPrefix + ' ' + (index + 1) + '/' + track.segments.length + '...'
        )
      }

      chunks.push(await fetchBytes(track.segments[index], null, context))
    }

    return concatUint8Arrays(chunks)
  }

  async function downloadHlsAsMp4(options) {
    var manifestUrl = options && options.manifestUrl ? String(options.manifestUrl) : ''
    var context = {
      tabId: options && typeof options.tabId === 'number' ? options.tabId : -1,
    }
    var shouldCancel = options && typeof options.shouldCancel === 'function'
      ? options.shouldCancel
      : null
    var onStatus = options && typeof options.onStatus === 'function'
      ? options.onStatus
      : null

    if (!manifestUrl) {
      throw new Error('Manifesto HLS ausente para download.')
    }

    throwIfCancelled(shouldCancel)
    if (onStatus) {
      onStatus(0, 'Preparando stream HLS...')
    }

    var mediaManifest = await resolveMediaManifest(manifestUrl)
    throwIfCancelled(shouldCancel)
    var hlsApi = ensureApi('BaixarHSLHls', root.BaixarHSLHls)
    var extracted = hlsApi.extractMediaEntries(mediaManifest.manifestText, mediaManifest.manifestUrl)
    if (!extracted.resources.length) {
      throw new Error('O manifesto HLS nao possui segmentos baixaveis.')
    }

    if (onStatus) {
      onStatus(10, 'Carregando motor de conversao...')
    }

    throwIfCancelled(shouldCancel)
    var ffmpeg = await ensureFfmpeg()
    var workDir = 'job-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    var inputPath = workDir + '/input.m3u8'
    var outputPath = workDir + '/output.mp4'

    await ffmpeg.createDir(workDir)

    var progressListener = function(event) {
      if (!onStatus || !event) return

      var ratio = typeof event.progress === 'number' ? event.progress : 0
      var percent = 70 + Math.round(ratio * 25)
      onStatus(percent, 'Convertendo para MP4...')
    }

    ffmpeg.on('progress', progressListener)

    try {
      await writeMediaResources(ffmpeg, workDir, extracted.resources, onStatus, context, shouldCancel)

      if (onStatus) {
        onStatus(65, 'Escrevendo manifesto local...')
      }

      throwIfCancelled(shouldCancel)
      await ffmpeg.writeFile(inputPath, new TextEncoder().encode(extracted.playlistText))

      if (onStatus) {
        onStatus(70, 'Montando arquivo MP4...')
      }

      await runFfmpegPipeline(ffmpeg, inputPath, outputPath, shouldCancel)

      if (onStatus) {
        onStatus(98, 'Finalizando download...')
      }

      throwIfCancelled(shouldCancel)
      var data = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(data)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
    }
  }

  // ── Vimeo CDN Referer injection ───────────────────────────────────────────
  // Segmentos /range/prot/ e /avf/ do vimeocdn.com exigem
  // Referer: https://player.vimeo.com/ ou o CDN retorna 403.
  // Usamos declarativeNetRequest para injetar o header durante o download.

  var VIMEO_REFERER_RULE_ID = 9001

  async function setVimeoRefererRule() {
    if (!root.chrome || !root.chrome.declarativeNetRequest) return
    try {
      await root.chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [VIMEO_REFERER_RULE_ID],
        addRules: [{
          id: VIMEO_REFERER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{
              header: 'Referer',
              operation: 'set',
              value: 'https://player.vimeo.com/',
            }],
          },
          condition: {
            urlFilter: '||vimeocdn.com/',
            resourceTypes: ['xmlhttprequest', 'other'],
          },
        }],
      })
    } catch (error) {
      void error
    }
  }

  async function clearVimeoRefererRule() {
    if (!root.chrome || !root.chrome.declarativeNetRequest) return
    try {
      await root.chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [VIMEO_REFERER_RULE_ID],
      })
    } catch (error) {
      void error
    }
  }

  async function downloadVimeoPlaylistAsMp4(options) {
    var option = options && options.option ? options.option : null
    var context = {
      tabId: options && typeof options.tabId === 'number' ? options.tabId : -1,
    }
    var shouldCancel = options && typeof options.shouldCancel === 'function'
      ? options.shouldCancel
      : null
    var onStatus = options && typeof options.onStatus === 'function'
      ? options.onStatus
      : null

    if (!option || !option.videoTrack) {
      throw new Error('Playlist segmentada do Vimeo sem faixa de video selecionada.')
    }

    throwIfCancelled(shouldCancel)
    if (onStatus) {
      onStatus(0, 'Preparando playlist segmentada do Vimeo...')
    }

    throwIfCancelled(shouldCancel)
    var ffmpeg = await ensureFfmpeg()
    var workDir = 'job-vimeo-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    var videoPath = workDir + '/video.mp4'
    var audioPath = workDir + '/audio.m4a'
    var outputPath = workDir + '/output.mp4'

    await ffmpeg.createDir(workDir)

    var progressListener = function(event) {
      if (!onStatus || !event) return

      var ratio = typeof event.progress === 'number' ? event.progress : 0
      var percent = 78 + Math.round(ratio * 18)
      onStatus(percent, 'Montando MP4 final...')
    }

    ffmpeg.on('progress', progressListener)

    // Injeta Referer para segmentos vimeocdn.com que exigem player.vimeo.com
    await setVimeoRefererRule()

    try {
      throwIfCancelled(shouldCancel)
      var videoBytes = await buildTrackBytes(option.videoTrack, 'Baixando video', 5, 45, onStatus, context, shouldCancel)
      await ffmpeg.writeFile(videoPath, videoBytes)

      var hasAudio = Boolean(option.audioTrack && Array.isArray(option.audioTrack.segments) && option.audioTrack.segments.length > 0)
      if (hasAudio) {
        throwIfCancelled(shouldCancel)
        var audioBytes = await buildTrackBytes(option.audioTrack, 'Baixando audio', 50, 20, onStatus, context, shouldCancel)
        await ffmpeg.writeFile(audioPath, audioBytes)
      }

      if (onStatus) {
        onStatus(75, 'Combinando video e audio...')
      }

      await runMuxPipeline(ffmpeg, videoPath, hasAudio ? audioPath : '', outputPath, shouldCancel)

      if (onStatus) {
        onStatus(98, 'Finalizando download...')
      }

      throwIfCancelled(shouldCancel)
      var output = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(output)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
      await clearVimeoRefererRule()
    }
  }

  // ── DASH download support ─────────────────────────────────────────────────

  function resolveUrl(path, baseUrl) {
    if (!path) return ''
    if (/^https?:\/\//i.test(path)) return path
    try {
      return new URL(path, baseUrl).href
    } catch {
      return path
    }
  }

  function resolveTemplate(template, repId, bandwidth, number, time) {
    return template
      .replace(/\$RepresentationID\$/g, String(repId || ''))
      .replace(/\$Bandwidth\$/g, String(bandwidth || ''))
      .replace(/\$Number%(\d+)d\$/g, function(_, width) {
        return String(number || 1).padStart(Number(width), '0')
      })
      .replace(/\$Number\$/g, String(number || 1))
      .replace(/\$Time\$/g, String(time || 0))
  }

  function getElementBaseUrl(element, parentBaseUrl) {
    if (!element) return parentBaseUrl
    var el = element.querySelector(':scope > BaseURL')
    if (!el || !el.textContent) return parentBaseUrl
    return resolveUrl(el.textContent.trim(), parentBaseUrl)
  }

  function extractSegmentTemplateUrls(template, representation, baseUrl) {
    var repId = representation.getAttribute('id') || ''
    var bandwidth = representation.getAttribute('bandwidth') || ''
    var timescale = Number(template.getAttribute('timescale') || 1)
    var initTemplate = template.getAttribute('initialization') || ''
    var mediaTemplate = template.getAttribute('media') || ''
    var startNumber = Number(template.getAttribute('startNumber') || 1)

    var urls = []

    if (initTemplate) {
      var initResolved = resolveTemplate(initTemplate, repId, bandwidth, 0, 0)
      urls.push(resolveUrl(initResolved, baseUrl))
    }

    var timeline = template.querySelector('SegmentTimeline')
    if (timeline) {
      var segments = Array.from(timeline.querySelectorAll('S'))
      var currentTime = 0
      var segNumber = startNumber

      for (var i = 0; i < segments.length; i++) {
        var s = segments[i]
        var t = s.getAttribute('t')
        if (t !== null) currentTime = Number(t)
        var d = Number(s.getAttribute('d') || 0)
        var r = Number(s.getAttribute('r') || 0)

        for (var rep = 0; rep <= r; rep++) {
          var mediaResolved = resolveTemplate(mediaTemplate, repId, bandwidth, segNumber, currentTime)
          urls.push(resolveUrl(mediaResolved, baseUrl))
          currentTime += d
          segNumber++
        }
      }

      return urls
    }

    var segDuration = Number(template.getAttribute('duration') || 0)
    if (segDuration > 0) {
      var mpdDuration = 0
      var period = template.closest('Period')
      var mpd = period && period.closest('MPD')
      var mediaPresentationDuration = mpd && mpd.getAttribute('mediaPresentationDuration')
      if (mediaPresentationDuration) {
        var dMatch = mediaPresentationDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/)
        if (dMatch) {
          mpdDuration = (Number(dMatch[1] || 0) * 3600) + (Number(dMatch[2] || 0) * 60) + Number(dMatch[3] || 0)
        }
      }
      if (mpdDuration > 0) {
        var totalSegments = Math.ceil(mpdDuration * timescale / segDuration)
        for (var n = startNumber; n < startNumber + totalSegments; n++) {
          var m = resolveTemplate(mediaTemplate, repId, bandwidth, n, 0)
          urls.push(resolveUrl(m, baseUrl))
        }
      }
    }

    return urls
  }

  function extractSegmentListUrls(segmentList, baseUrl) {
    var urls = []
    var initEl = segmentList.querySelector(':scope > Initialization')
    if (initEl) {
      var src = initEl.getAttribute('sourceURL')
      if (src) urls.push(resolveUrl(src, baseUrl))
    }
    var segUrls = Array.from(segmentList.querySelectorAll(':scope > SegmentURL'))
    for (var i = 0; i < segUrls.length; i++) {
      var media = segUrls[i].getAttribute('media')
      if (media) urls.push(resolveUrl(media, baseUrl))
    }
    return urls
  }

  function getAdaptationSetSegmentUrls(adaptationSet, baseUrl) {
    var representations = Array.from(adaptationSet.querySelectorAll(':scope > Representation'))
    if (!representations.length) return []

    var bestRep = representations.reduce(function(best, rep) {
      return Number(rep.getAttribute('bandwidth') || 0) > Number(best.getAttribute('bandwidth') || 0) ? rep : best
    })

    var asBase = getElementBaseUrl(adaptationSet, baseUrl)
    var repBase = getElementBaseUrl(bestRep, asBase)

    var segList = bestRep.querySelector(':scope > SegmentList') || adaptationSet.querySelector(':scope > SegmentList')
    if (segList) return extractSegmentListUrls(segList, repBase)

    var segTemplate = bestRep.querySelector(':scope > SegmentTemplate') || adaptationSet.querySelector(':scope > SegmentTemplate')
    if (segTemplate) return extractSegmentTemplateUrls(segTemplate, bestRep, repBase)

    var singleUrl = bestRep.querySelector(':scope > BaseURL')
    if (singleUrl && singleUrl.textContent) return [resolveUrl(singleUrl.textContent.trim(), repBase)]

    return []
  }

  function parseDashManifest(mpdText, mpdUrl) {
    var parser = new DOMParser()
    var doc = parser.parseFromString(mpdText, 'application/xml')

    var parseError = doc.querySelector('parsererror')
    if (parseError) throw new Error('Manifesto DASH invalido (MPD nao pode ser analisado).')

    var mpdBase = mpdUrl.substring(0, mpdUrl.lastIndexOf('/') + 1)
    var docBase = getElementBaseUrl(doc.documentElement, mpdBase)

    var period = doc.querySelector('Period')
    if (!period) throw new Error('Manifesto DASH sem Period.')
    var periodBase = getElementBaseUrl(period, docBase)

    var adaptationSets = Array.from(period.querySelectorAll(':scope > AdaptationSet'))

    function isVideoSet(as) {
      var mime = (as.getAttribute('mimeType') || '').toLowerCase()
      var ct = (as.getAttribute('contentType') || '').toLowerCase()
      if (mime.includes('video') || ct === 'video') return true
      var rep = as.querySelector('Representation')
      return rep ? (rep.getAttribute('mimeType') || '').toLowerCase().includes('video') : false
    }

    function isAudioSet(as) {
      var mime = (as.getAttribute('mimeType') || '').toLowerCase()
      var ct = (as.getAttribute('contentType') || '').toLowerCase()
      if (mime.includes('audio') || ct === 'audio') return true
      var rep = as.querySelector('Representation')
      return rep ? (rep.getAttribute('mimeType') || '').toLowerCase().includes('audio') : false
    }

    var videoSet = adaptationSets.find(isVideoSet) || null
    var audioSet = adaptationSets.find(isAudioSet) || null

    if (!videoSet) throw new Error('Manifesto DASH sem faixa de video.')

    return {
      audioUrls: audioSet ? getAdaptationSetSegmentUrls(audioSet, periodBase) : [],
      videoUrls: getAdaptationSetSegmentUrls(videoSet, periodBase),
    }
  }

  async function downloadDashAsMp4(options) {
    var mpdUrl = options && options.mpdUrl ? String(options.mpdUrl) : ''
    var context = {
      tabId: options && typeof options.tabId === 'number' ? options.tabId : -1,
    }
    var shouldCancel = options && typeof options.shouldCancel === 'function'
      ? options.shouldCancel
      : null
    var onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : null

    if (!mpdUrl) throw new Error('URL do manifesto DASH ausente.')

    throwIfCancelled(shouldCancel)
    if (onStatus) onStatus(0, 'Preparando stream DASH...')

    var mpdText = await fetchText(mpdUrl)
    throwIfCancelled(shouldCancel)
    var parsed = parseDashManifest(mpdText, mpdUrl)

    if (!parsed.videoUrls.length) throw new Error('Manifesto DASH sem segmentos de video.')

    if (onStatus) onStatus(5, 'Carregando motor de conversao...')
    throwIfCancelled(shouldCancel)
    var ffmpeg = await ensureFfmpeg()
    var workDir = 'job-dash-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    var videoPath = workDir + '/video.mp4'
    var audioPath = workDir + '/audio.m4a'
    var outputPath = workDir + '/output.mp4'

    await ffmpeg.createDir(workDir)

    var videoChunks = []
    var totalSegs = parsed.videoUrls.length + parsed.audioUrls.length
    var downloaded = 0

    for (var vi = 0; vi < parsed.videoUrls.length; vi++) {
      throwIfCancelled(shouldCancel)
      if (onStatus) onStatus(5 + Math.round((downloaded / totalSegs) * 55), 'Baixando video ' + (vi + 1) + '/' + parsed.videoUrls.length + '...')
      videoChunks.push(await fetchBytes(parsed.videoUrls[vi], null, context))
      downloaded++
    }
    throwIfCancelled(shouldCancel)
    await ffmpeg.writeFile(videoPath, concatUint8Arrays(videoChunks))

    var hasAudio = parsed.audioUrls.length > 0
    if (hasAudio) {
      var audioChunks = []
      for (var ai = 0; ai < parsed.audioUrls.length; ai++) {
        throwIfCancelled(shouldCancel)
        if (onStatus) onStatus(60 + Math.round((ai / parsed.audioUrls.length) * 15), 'Baixando audio ' + (ai + 1) + '/' + parsed.audioUrls.length + '...')
        audioChunks.push(await fetchBytes(parsed.audioUrls[ai], null, context))
      }
      throwIfCancelled(shouldCancel)
      await ffmpeg.writeFile(audioPath, concatUint8Arrays(audioChunks))
    }

    if (onStatus) onStatus(78, 'Combinando video e audio...')

    var progressListener = function(event) {
      if (!onStatus || !event) return
      var ratio = typeof event.progress === 'number' ? event.progress : 0
      onStatus(78 + Math.round(ratio * 18), 'Montando MP4 final...')
    }
    ffmpeg.on('progress', progressListener)

    try {
      await runMuxPipeline(ffmpeg, videoPath, hasAudio ? audioPath : '', outputPath, shouldCancel)
      if (onStatus) onStatus(98, 'Finalizando download...')
      throwIfCancelled(shouldCancel)
      var output = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(output)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
    }
  }

  function saveBlobToDisk(blob, filename) {
    return new Promise(function(resolve, reject) {
      var objectUrl = URL.createObjectURL(blob)
      var revokeObjectUrl = function() {
        setTimeout(function() {
          URL.revokeObjectURL(objectUrl)
        }, 15000)
      }

      var downloadsApi = root.chrome && root.chrome.downloads
      if (downloadsApi && typeof downloadsApi.download === 'function') {
        downloadsApi.download({
          filename: filename,
          saveAs: true,
          url: objectUrl,
        }, function(downloadId) {
          var error = chrome.runtime && chrome.runtime.lastError
          revokeObjectUrl()

          if (error) {
            reject(new Error(error.message || 'Falha ao iniciar o download do arquivo convertido.'))
            return
          }

          resolve(downloadId)
        })
        return
      }

      try {
        if (!root.document || !root.document.body) {
          revokeObjectUrl()
          reject(new Error('API de download indisponivel neste contexto do worker.'))
          return
        }

        var link = root.document.createElement('a')
        link.href = objectUrl
        link.download = String(filename || 'video.mp4')
        link.rel = 'noopener'
        link.style.display = 'none'
        root.document.body.appendChild(link)
        link.click()
        root.document.body.removeChild(link)
        revokeObjectUrl()
        resolve(null)
      } catch (error) {
        revokeObjectUrl()
        reject(error instanceof Error ? error : new Error('Falha ao salvar o arquivo convertido.'))
      }
    })
  }

  var api = {
    buildConcatList: buildConcatList,
    buildSegmentFilename: buildSegmentFilename,
    downloadDashAsMp4: downloadDashAsMp4,
    downloadHlsAsMp4: downloadHlsAsMp4,
    downloadVimeoPlaylistAsMp4: downloadVimeoPlaylistAsMp4,
    saveBlobToDisk: saveBlobToDisk,
  }

  root.BaixarHSLHlsDownload = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)


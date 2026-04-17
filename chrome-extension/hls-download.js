;(function(root) {
  var ffmpegInstance = null
  var ffmpegLoadPromise = null

  function ensureApi(name, value) {
    if (!value) {
      throw new Error(name + ' nao esta disponivel nesta extensao.')
    }

    return value
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

  async function fetchText(url) {
    var response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Falha ao buscar manifesto HLS: HTTP ' + response.status)
    }

    return response.text()
  }

  async function fetchBytes(url) {
    var response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Falha ao baixar recurso HLS: HTTP ' + response.status)
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

  async function writeMediaResources(ffmpeg, workDir, resources, onStatus) {
    for (var index = 0; index < resources.length; index += 1) {
      var resource = resources[index]
      var percent = resources.length > 0
        ? Math.round((index / resources.length) * 60)
        : 0

      if (onStatus) {
        onStatus(percent, 'Baixando segmentos ' + (index + 1) + '/' + resources.length + '...')
      }

      var bytes = await fetchBytes(resource.url)
      await ffmpeg.writeFile(workDir + '/' + resource.filename, bytes)
    }
  }

  async function runFfmpegPipeline(ffmpeg, inputPath, outputPath) {
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

    if (exitCode === 0) return

    try {
      await ffmpeg.deleteFile(outputPath)
    } catch (error) {
      void error
    }

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

    if (exitCode !== 0) {
      throw new Error('Falha ao converter o stream HLS para MP4.')
    }
  }

  async function runMuxPipeline(ffmpeg, videoPath, audioPath, outputPath) {
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
    if (exitCode !== 0) {
      throw new Error('Falha ao montar o MP4 final do Vimeo.')
    }
  }

  async function resolveTrackInitBytes(track) {
    if (!track || !track.initSegment) return new Uint8Array(0)

    var rawValue = String(track.initSegment).trim()
    if (!rawValue) return new Uint8Array(0)

    if (looksLikeUrl(rawValue)) {
      var initUrl = new URL(rawValue, track.baseUrl || undefined).href
      return fetchBytes(initUrl)
    }

    try {
      return decodeBase64ToBytes(rawValue)
    } catch {
      if (track.baseUrl) {
        try {
          return fetchBytes(new URL(rawValue, track.baseUrl).href)
        } catch (urlError) {
          void urlError
        }
      }

      throw new Error('Falha ao decodificar o segmento inicial do Vimeo.')
    }
  }

  async function buildTrackBytes(track, statusPrefix, progressStart, progressSpan, onStatus) {
    if (!track || !Array.isArray(track.segments) || track.segments.length === 0) {
      throw new Error('Faixa segmentada do Vimeo sem segmentos utilizaveis.')
    }

    var chunks = []
    var initBytes = await resolveTrackInitBytes(track)
    if (initBytes.length) {
      chunks.push(initBytes)
    }

    for (var index = 0; index < track.segments.length; index += 1) {
      if (onStatus) {
        var ratio = track.segments.length > 0 ? index / track.segments.length : 0
        onStatus(
          progressStart + Math.round(ratio * progressSpan),
          statusPrefix + ' ' + (index + 1) + '/' + track.segments.length + '...'
        )
      }

      chunks.push(await fetchBytes(track.segments[index]))
    }

    return concatUint8Arrays(chunks)
  }

  async function downloadHlsAsMp4(options) {
    var manifestUrl = options && options.manifestUrl ? String(options.manifestUrl) : ''
    var onStatus = options && typeof options.onStatus === 'function'
      ? options.onStatus
      : null

    if (!manifestUrl) {
      throw new Error('Manifesto HLS ausente para download.')
    }

    if (onStatus) {
      onStatus(0, 'Preparando stream HLS...')
    }

    var mediaManifest = await resolveMediaManifest(manifestUrl)
    var hlsApi = ensureApi('BaixarHSLHls', root.BaixarHSLHls)
    var extracted = hlsApi.extractMediaEntries(mediaManifest.manifestText, mediaManifest.manifestUrl)
    if (!extracted.resources.length) {
      throw new Error('O manifesto HLS nao possui segmentos baixaveis.')
    }

    if (onStatus) {
      onStatus(10, 'Carregando motor de conversao...')
    }

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
      await writeMediaResources(ffmpeg, workDir, extracted.resources, onStatus)

      if (onStatus) {
        onStatus(65, 'Escrevendo manifesto local...')
      }

      await ffmpeg.writeFile(inputPath, new TextEncoder().encode(extracted.playlistText))

      if (onStatus) {
        onStatus(70, 'Montando arquivo MP4...')
      }

      await runFfmpegPipeline(ffmpeg, inputPath, outputPath)

      if (onStatus) {
        onStatus(98, 'Finalizando download...')
      }

      var data = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(data)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
    }
  }

  async function downloadVimeoPlaylistAsMp4(options) {
    var option = options && options.option ? options.option : null
    var onStatus = options && typeof options.onStatus === 'function'
      ? options.onStatus
      : null

    if (!option || !option.videoTrack) {
      throw new Error('Playlist segmentada do Vimeo sem faixa de video selecionada.')
    }

    if (onStatus) {
      onStatus(0, 'Preparando playlist segmentada do Vimeo...')
    }

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

    try {
      var videoBytes = await buildTrackBytes(option.videoTrack, 'Baixando video', 5, 45, onStatus)
      await ffmpeg.writeFile(videoPath, videoBytes)

      var hasAudio = Boolean(option.audioTrack && Array.isArray(option.audioTrack.segments) && option.audioTrack.segments.length > 0)
      if (hasAudio) {
        var audioBytes = await buildTrackBytes(option.audioTrack, 'Baixando audio', 50, 20, onStatus)
        await ffmpeg.writeFile(audioPath, audioBytes)
      }

      if (onStatus) {
        onStatus(75, 'Combinando video e audio...')
      }

      await runMuxPipeline(ffmpeg, videoPath, hasAudio ? audioPath : '', outputPath)

      if (onStatus) {
        onStatus(98, 'Finalizando download...')
      }

      var output = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(output)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
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
    var onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : null

    if (!mpdUrl) throw new Error('URL do manifesto DASH ausente.')

    if (onStatus) onStatus(0, 'Preparando stream DASH...')

    var mpdText = await fetchText(mpdUrl)
    var parsed = parseDashManifest(mpdText, mpdUrl)

    if (!parsed.videoUrls.length) throw new Error('Manifesto DASH sem segmentos de video.')

    if (onStatus) onStatus(5, 'Carregando motor de conversao...')
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
      if (onStatus) onStatus(5 + Math.round((downloaded / totalSegs) * 55), 'Baixando video ' + (vi + 1) + '/' + parsed.videoUrls.length + '...')
      videoChunks.push(await fetchBytes(parsed.videoUrls[vi]))
      downloaded++
    }
    await ffmpeg.writeFile(videoPath, concatUint8Arrays(videoChunks))

    var hasAudio = parsed.audioUrls.length > 0
    if (hasAudio) {
      var audioChunks = []
      for (var ai = 0; ai < parsed.audioUrls.length; ai++) {
        if (onStatus) onStatus(60 + Math.round((ai / parsed.audioUrls.length) * 15), 'Baixando audio ' + (ai + 1) + '/' + parsed.audioUrls.length + '...')
        audioChunks.push(await fetchBytes(parsed.audioUrls[ai]))
      }
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
      await runMuxPipeline(ffmpeg, videoPath, hasAudio ? audioPath : '', outputPath)
      if (onStatus) onStatus(98, 'Finalizando download...')
      var output = await ffmpeg.readFile(outputPath)
      return new Blob([arrayBufferFromUint8Array(output)], { type: 'video/mp4' })
    } finally {
      ffmpeg.off('progress', progressListener)
    }
  }

  function saveBlobToDisk(blob, filename) {
    return new Promise(function(resolve, reject) {
      var objectUrl = URL.createObjectURL(blob)

      chrome.downloads.download({
        filename: filename,
        saveAs: true,
        url: objectUrl,
      }, function(downloadId) {
        var error = chrome.runtime.lastError

        setTimeout(function() {
          URL.revokeObjectURL(objectUrl)
        }, 15000)

        if (error) {
          reject(new Error(error.message || 'Falha ao iniciar o download do arquivo convertido.'))
          return
        }

        resolve(downloadId)
      })
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

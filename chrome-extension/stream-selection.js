;(function(root) {
  function getUrl(value) {
    return String(value || '').toLowerCase()
  }

  function isPartialMediaFragmentUrl(url) {
    var lower = getUrl(url)
    return (
      lower.includes('/range/') ||
      lower.includes('/segment/') ||
      lower.includes('.m4s') ||
      /[?&]range=/.test(lower)
    )
  }

  function scoreStream(stream) {
    if (!stream) return -1

    var type = String(stream.type || '').toLowerCase()
    var url = getUrl(stream.url)

    if (type === 'progressive' && isPartialMediaFragmentUrl(url)) return 20
    if (type === 'progressive') return 100
    if (type === 'hls') return 90
    if (type === 'vimeo' && /\/config(?:[?#]|$)/i.test(url)) return 85
    if (type === 'vimeo' && /(playlist|master)\.json/i.test(url)) return 70
    if (type === 'dash') return 40
    return 0
  }

  function sortStreamsForSelection(streams) {
    return (Array.isArray(streams) ? streams.slice() : []).sort(function(left, right) {
      var scoreDiff = scoreStream(right) - scoreStream(left)
      if (scoreDiff !== 0) return scoreDiff
      return Number(right && right.timestamp || 0) - Number(left && left.timestamp || 0)
    })
  }

  var api = {
    isPartialMediaFragmentUrl: isPartialMediaFragmentUrl,
    scoreStream: scoreStream,
    sortStreamsForSelection: sortStreamsForSelection,
  }

  root.BaixarHSLStreamSelection = api

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof self !== 'undefined' ? self : globalThis)

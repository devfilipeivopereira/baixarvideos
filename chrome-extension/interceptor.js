;(function () {
  console.log('[BaixarHSL] interceptor ativo — monitorando XHR e fetch')

  function notify(url) {
    if (!url || !url.includes('.m3u8')) return
    console.log('[BaixarHSL] .m3u8 detectado:', url)
    window.postMessage({ __baixarhsl__: true, url: url }, '*')
  }

  // Interceptar XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    try { notify(String(url)) } catch (_) {}
    return origOpen.apply(this, arguments)
  }

  // Interceptar fetch
  var origFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '')
      notify(url)
    } catch (_) {}
    return origFetch.apply(this, arguments)
  }
})()

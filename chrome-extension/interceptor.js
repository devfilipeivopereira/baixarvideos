;(function () {
  function notify(url) {
    if (!url || !url.includes('.m3u8')) return
    window.postMessage({ __baixarhsl__: true, url: url }, '*')
  }

  // Interceptar XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    try { notify(String(url)) } catch (_) {}
    return origOpen.apply(this, arguments)
  }

  // Interceptar fetch
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '')
      notify(url)
    } catch (_) {}
    return origFetch.apply(this, arguments)
  }
})()

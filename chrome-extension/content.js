// Injeta interceptor.js no contexto MAIN da página
var s = document.createElement('script')
s.src = chrome.runtime.getURL('interceptor.js')
s.onload = function() { s.remove() }
;(document.head || document.documentElement).appendChild(s)

// Recebe URL capturada e salva direto no storage (sem passar pelo background)
window.addEventListener('message', function(event) {
  if (!event.data || !event.data.__baixarhsl__) return
  var url = event.data.url
  if (!url || !url.includes('.m3u8')) return

  chrome.storage.local.get('streams', function(r) {
    var streams = r.streams || []
    if (streams.some(function(x) { return x.url === url })) return
    streams.unshift({ url: url, timestamp: Date.now() })
    if (streams.length > 30) streams = streams.slice(0, 30)
    chrome.storage.local.set({ streams: streams })
  })
})

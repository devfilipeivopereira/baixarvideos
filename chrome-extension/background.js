// webRequest para requisições nativas do browser (não capturadas pelo XHR/fetch intercept)
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    var url = details.url
    if (!url.includes('.m3u8')) return

    chrome.storage.local.get('streams', function(r) {
      var streams = r.streams || []
      if (streams.some(function(s) { return s.url === url })) return
      streams.unshift({ url: url, tabId: details.tabId, timestamp: Date.now() })
      if (streams.length > 30) streams = streams.slice(0, 30)
      chrome.storage.local.set({ streams: streams })
    })
  },
  { urls: ['<all_urls>'] }
)

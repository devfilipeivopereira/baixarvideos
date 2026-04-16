function saveStream(url, tabId) {
  if (!url || !url.includes('.m3u8')) return

  chrome.storage.local.get('streams', function(r) {
    var streams = r.streams || []
    if (streams.some(function(s) { return s.url === url })) return

    streams.unshift({ url: url, tabId: tabId || -1, timestamp: Date.now() })
    if (streams.length > 30) streams = streams.slice(0, 30)

    chrome.storage.local.set({ streams: streams })
    chrome.action.setBadgeText({ text: String(streams.length) })
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' })
  })
}

// Via webRequest (players nativos do browser)
chrome.webRequest.onBeforeRequest.addListener(
  function(details) { saveStream(details.url, details.tabId) },
  { urls: ['<all_urls>'] }
)

// Via content script (players JS que usam XHR/fetch)
chrome.runtime.onMessage.addListener(function(message, sender) {
  if (message.type === 'stream_found') {
    saveStream(message.url, sender.tab ? sender.tab.id : -1)
  }
})

// Monitora todas as requisições e captura URLs .m3u8
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url
    if (!url.includes('.m3u8')) return

    chrome.storage.local.get(['streams'], (result) => {
      const streams = result.streams || []
      if (streams.some((s) => s.url === url)) return

      const entry = { url, tabId: details.tabId, timestamp: Date.now() }
      const updated = [entry, ...streams].slice(0, 30)
      chrome.storage.local.set({ streams: updated })

      chrome.action.setBadgeText({ text: String(updated.length) })
      chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' })
    })
  },
  { urls: ['<all_urls>'] }
  // sem 'requestBody' — não é listener bloqueante
)

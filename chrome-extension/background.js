chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'stream_found') return

  const url = message.url
  if (!url) return

  chrome.storage.local.get(['streams'], (result) => {
    const streams = result.streams || []
    if (streams.some((s) => s.url === url)) return

    const entry = {
      url,
      tabId: sender.tab?.id ?? -1,
      timestamp: Date.now(),
    }

    const updated = [entry, ...streams].slice(0, 30)
    chrome.storage.local.set({ streams: updated })

    chrome.action.setBadgeText({ text: String(updated.length) })
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' })
  })
})

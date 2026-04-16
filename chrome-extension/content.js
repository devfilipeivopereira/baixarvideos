// Injeta interceptor.js no contexto da página (MAIN world) para capturar XHR/fetch
const script = document.createElement('script')
script.src = chrome.runtime.getURL('interceptor.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

// Recebe mensagens do interceptor e repassa ao background
window.addEventListener('message', (event) => {
  if (!event.data || !event.data.__baixarhsl__) return
  const url = event.data.url
  if (!url || !url.includes('.m3u8')) return
  chrome.runtime.sendMessage({ type: 'stream_found', url })
})

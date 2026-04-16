const APP_URL = 'https://baixarhsl.vercel.app'

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return `há ${diff}s`
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`
  return `há ${Math.floor(diff / 3600)}h`
}

function render(streams) {
  const content = document.getElementById('content')

  if (!streams || streams.length === 0) {
    content.innerHTML = `
      <div class="empty">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <p>Nenhum stream capturado ainda</p>
        <small>Navegue até a página do vídeo para capturar o .m3u8</small>
      </div>`
    return
  }

  content.innerHTML = `<div class="list">${streams.map((s, i) => `
    <div class="item">
      <div class="item-url">${s.url}</div>
      <div class="item-meta">${timeAgo(s.timestamp)}</div>
      <div class="item-actions">
        <button class="btn btn-primary" data-action="baixar" data-url="${encodeURIComponent(s.url)}">
          Baixar
        </button>
        <button class="btn btn-ghost" data-action="copiar" data-url="${s.url}" data-index="${i}">
          Copiar URL
        </button>
        <button class="btn btn-danger" data-action="remover" data-index="${i}">
          ✕
        </button>
      </div>
    </div>`).join('')}
  </div>`

  // Event delegation
  content.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return

    const action = btn.dataset.action
    const url = btn.dataset.url ? decodeURIComponent(btn.dataset.url) : null
    const index = btn.dataset.index !== undefined ? parseInt(btn.dataset.index) : null

    if (action === 'baixar') {
      chrome.tabs.create({ url: `${APP_URL}?stream=${encodeURIComponent(url)}` })
    }

    if (action === 'copiar') {
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = 'Copiado!'
        btn.classList.add('copied')
        setTimeout(() => {
          btn.textContent = 'Copiar URL'
          btn.classList.remove('copied')
        }, 1500)
      })
    }

    if (action === 'remover') {
      chrome.storage.local.get(['streams'], (result) => {
        const updated = (result.streams || []).filter((_, i) => i !== index)
        chrome.storage.local.set({ streams: updated })
        chrome.action.setBadgeText({ text: updated.length > 0 ? String(updated.length) : '' })
        render(updated)
      })
    }
  })
}

// Carregar streams ao abrir popup
chrome.storage.local.get(['streams'], (result) => {
  render(result.streams || [])
})

// Botões do toolbar
document.getElementById('openApp').addEventListener('click', () => {
  chrome.tabs.create({ url: APP_URL })
})

document.getElementById('refresh').addEventListener('click', () => {
  chrome.storage.local.get(['streams'], (result) => {
    render(result.streams || [])
  })
})

document.getElementById('clearAll').addEventListener('click', () => {
  chrome.storage.local.set({ streams: [] })
  chrome.action.setBadgeText({ text: '' })
  render([])
})

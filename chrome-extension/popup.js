let currentStreams = []

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return s + 's atrás'
  if (s < 3600) return Math.floor(s / 60) + 'min atrás'
  return Math.floor(s / 3600) + 'h atrás'
}

function render() {
  const list = document.getElementById('list')
  const empty = document.getElementById('empty')

  if (currentStreams.length === 0) {
    empty.style.display = 'block'
    list.innerHTML = ''
    return
  }

  empty.style.display = 'none'
  list.innerHTML = currentStreams.map((s, i) => `
    <div class="item">
      <div class="url">${s.url}</div>
      <div class="meta">${timeAgo(s.timestamp)}</div>
      <div class="actions">
        <button class="btn-copy" data-i="${i}">Copiar URL</button>
        <button class="btn-del" data-i="${i}">✕</button>
      </div>
    </div>
  `).join('')
}

function load() {
  chrome.storage.local.get('streams', (r) => {
    currentStreams = r.streams || []
    render()
  })
}

// Copiar / remover via delegação no list
document.getElementById('list').addEventListener('click', (e) => {
  const copy = e.target.closest('.btn-copy')
  const del  = e.target.closest('.btn-del')

  if (copy) {
    const url = currentStreams[+copy.dataset.i].url
    navigator.clipboard.writeText(url).then(() => {
      copy.textContent = '✓ Copiado!'
      setTimeout(() => { copy.textContent = 'Copiar URL' }, 2000)
    })
  }

  if (del) {
    const i = +del.dataset.i
    currentStreams.splice(i, 1)
    chrome.storage.local.set({ streams: currentStreams })
    chrome.action.setBadgeText({ text: currentStreams.length ? String(currentStreams.length) : '' })
    render()
  }
})

document.getElementById('btnRefresh').addEventListener('click', load)

document.getElementById('btnClear').addEventListener('click', () => {
  currentStreams = []
  chrome.storage.local.set({ streams: [] })
  chrome.action.setBadgeText({ text: '' })
  render()
})

// Inicializar
load()

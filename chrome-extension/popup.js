var currentStreams = []

function timeAgo(ts) {
  var s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return s + 's atrás'
  if (s < 3600) return Math.floor(s / 60) + 'min atrás'
  return Math.floor(s / 3600) + 'h atrás'
}

function render() {
  var status = document.getElementById('status')
  var list   = document.getElementById('list')

  if (currentStreams.length === 0) {
    status.textContent = 'Nenhum stream capturado. Navegue até a página do vídeo e clique Atualizar.'
    list.innerHTML = ''
    return
  }

  status.textContent = currentStreams.length + ' stream(s) capturado(s):'
  list.innerHTML = currentStreams.map(function(s, i) {
    return '<div style="padding:10px 12px;border-top:1px solid #f3f4f6;background:white">' +
      '<div style="font-size:11px;font-family:monospace;word-break:break-all;color:#374151">' + s.url + '</div>' +
      '<div style="font-size:10px;color:#9ca3af;margin-top:3px">' + timeAgo(s.timestamp) + '</div>' +
      '<div style="margin-top:5px;display:flex;gap:5px">' +
        '<button onclick="copiar(' + i + ',this)" style="background:#4f46e5;color:white;font-size:11px;padding:4px 8px;border-radius:5px;border:none;cursor:pointer">Copiar URL</button>' +
        '<button onclick="remover(' + i + ')" style="background:#fee2e2;color:#dc2626;font-size:11px;padding:4px 8px;border-radius:5px;border:none;cursor:pointer">✕</button>' +
      '</div>' +
    '</div>'
  }).join('')
}

function load() {
  chrome.storage.local.get('streams', function(r) {
    currentStreams = (r && r.streams) ? r.streams : []
    render()
  })
}

function copiar(i, btn) {
  navigator.clipboard.writeText(currentStreams[i].url).then(function() {
    btn.textContent = '✓ Copiado!'
    setTimeout(function() { btn.textContent = 'Copiar URL' }, 2000)
  })
}

function remover(i) {
  currentStreams.splice(i, 1)
  chrome.storage.local.set({ streams: currentStreams })
  render()
}

document.getElementById('btnRefresh').addEventListener('click', load)
document.getElementById('btnClear').addEventListener('click', function() {
  currentStreams = []
  chrome.storage.local.set({ streams: [] })
  render()
})

load()

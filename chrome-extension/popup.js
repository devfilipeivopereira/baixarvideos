var currentStreams = []

function timeAgo(ts) {
  var s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return s + 's atrás'
  if (s < 3600) return Math.floor(s / 60) + 'min atrás'
  return Math.floor(s / 3600) + 'h atrás'
}

function render() {
  var list  = document.getElementById('list')
  var empty = document.getElementById('empty')

  if (currentStreams.length === 0) {
    empty.style.display = 'block'
    list.innerHTML = ''
    return
  }

  empty.style.display = 'none'
  list.innerHTML = currentStreams.map(function(s, i) {
    return '<div style="padding:10px 12px;border-bottom:1px solid #f3f4f6;background:white">' +
      '<div style="font-size:11px;font-family:monospace;word-break:break-all;color:#374151;line-height:1.4">' + s.url + '</div>' +
      '<div style="font-size:10px;color:#9ca3af;margin-top:3px">' + timeAgo(s.timestamp) + '</div>' +
      '<div style="display:flex;gap:5px;margin-top:5px">' +
        '<button class="btn-copy" data-i="' + i + '" style="background:#4f46e5;color:white;font-size:11px;padding:4px 8px;border-radius:5px;border:none;cursor:pointer">Copiar URL</button>' +
        '<button class="btn-del"  data-i="' + i + '" style="background:#fee2e2;color:#dc2626;font-size:11px;padding:4px 8px;border-radius:5px;border:none;cursor:pointer">✕</button>' +
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

// Script está no final do body — DOM já está pronto, sem DOMContentLoaded
document.getElementById('list').addEventListener('click', function(e) {
  var copy = e.target.closest('.btn-copy')
  var del  = e.target.closest('.btn-del')

  if (copy) {
    var url = currentStreams[parseInt(copy.dataset.i)].url
    navigator.clipboard.writeText(url).then(function() {
      copy.textContent = '✓ Copiado!'
      setTimeout(function() { copy.textContent = 'Copiar URL' }, 2000)
    })
  }

  if (del) {
    currentStreams.splice(parseInt(del.dataset.i), 1)
    chrome.storage.local.set({ streams: currentStreams })
    render()
  }
})

document.getElementById('btnRefresh').addEventListener('click', load)

document.getElementById('btnClear').addEventListener('click', function() {
  currentStreams = []
  chrome.storage.local.set({ streams: [] })
  render()
})

load()

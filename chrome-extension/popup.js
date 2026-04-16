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
    return '<div class="item">' +
      '<div class="url">' + s.url + '</div>' +
      '<div class="meta">' + timeAgo(s.timestamp) + '</div>' +
      '<div class="actions">' +
        '<button class="btn-copy" data-i="' + i + '">Copiar URL</button>' +
        '<button class="btn-del"  data-i="' + i + '">✕</button>' +
      '</div>' +
    '</div>'
  }).join('')
}

function load() {
  chrome.storage.local.get('streams', function(r) {
    currentStreams = r.streams || []
    render()
  })
}

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

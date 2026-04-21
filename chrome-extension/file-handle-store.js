;(function(root) {
  var DB_NAME = 'BaixarHSLFileHandleStore'
  var DB_VERSION = 1
  var STORE_NAME = 'handles'

  function openDatabase() {
    return new Promise(function(resolve, reject) {
      var indexedDbApi = root.indexedDB
      if (!indexedDbApi) {
        reject(new Error('IndexedDB indisponivel neste contexto.'))
        return
      }

      var request = indexedDbApi.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = function() {
        var db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }

      request.onsuccess = function() {
        resolve(request.result)
      }

      request.onerror = function() {
        reject(request.error || new Error('Falha ao abrir o banco local da extensao.'))
      }
    })
  }

  async function withStore(mode, handler) {
    var db = await openDatabase()

    return new Promise(function(resolve, reject) {
      var transaction = db.transaction(STORE_NAME, mode)
      var store = transaction.objectStore(STORE_NAME)

      transaction.oncomplete = function() {
        db.close()
      }

      transaction.onerror = function() {
        reject(transaction.error || new Error('Falha ao acessar o armazenamento local.'))
      }

      Promise.resolve()
        .then(function() {
          return handler(store, transaction)
        })
        .then(resolve)
        .catch(function(error) {
          try {
            transaction.abort()
          } catch (abortError) {
            void abortError
          }
          reject(error)
        })
    })
  }

  function requestToPromise(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result)
      }
      request.onerror = function() {
        reject(request.error || new Error('Falha ao concluir operacao local.'))
      }
    })
  }

  function buildPickerTypes(filename) {
    var lower = String(filename || '').toLowerCase()
    var isAudio = lower.endsWith('.m4a') || lower.endsWith('.mp3') || lower.endsWith('.aac')

    if (isAudio) {
      return [{
        accept: {
          'audio/mp4': ['.m4a'],
          'audio/mpeg': ['.mp3'],
          'audio/aac': ['.aac'],
        },
        description: 'Arquivos de audio',
      }]
    }

    return [{
      accept: {
        'video/mp4': ['.mp4'],
      },
      description: 'Arquivos MP4',
    }]
  }

  async function showSavePicker(filename) {
    if (typeof root.showSaveFilePicker !== 'function') {
      throw new Error('O seletor de arquivo nao esta disponivel neste navegador.')
    }

    var safeName = String(filename || 'video.mp4').trim() || 'video.mp4'
    return root.showSaveFilePicker({
      excludeAcceptAllOption: false,
      suggestedName: safeName,
      types: buildPickerTypes(safeName),
    })
  }

  async function storeHandle(key, handle, meta) {
    if (!key) throw new Error('Chave ausente para armazenar o arquivo de destino.')
    if (!handle) throw new Error('Handle de arquivo ausente.')

    return withStore('readwrite', function(store) {
      return requestToPromise(store.put({
        handle: handle,
        key: String(key),
        meta: meta && typeof meta === 'object' ? Object.assign({}, meta) : {},
        storedAt: Date.now(),
      }, String(key)))
    })
  }

  async function getStoredHandle(key) {
    if (!key) return null

    var entry = await withStore('readonly', function(store) {
      return requestToPromise(store.get(String(key)))
    })

    if (!entry || typeof entry !== 'object' || !entry.handle) return null
    return entry
  }

  async function deleteStoredHandle(key) {
    if (!key) return

    await withStore('readwrite', function(store) {
      return requestToPromise(store.delete(String(key)))
    })
  }

  root.BaixarHSLFileHandleStore = {
    deleteStoredHandle: deleteStoredHandle,
    getStoredHandle: getStoredHandle,
    showSavePicker: showSavePicker,
    storeHandle: storeHandle,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BaixarHSLFileHandleStore
  }
})(typeof self !== 'undefined' ? self : globalThis)

/**
 * Tiny promise wrapper over IndexedDB.
 *
 * The app stores exactly two things locally:
 *   - the generated avatar GLB (+ its face texture) so photo mode survives a reload
 *   - user preferences
 *
 * Nothing is ever uploaded. "Delete my avatar" clears both stores and the
 * service-worker caches, which is the whole privacy story in three functions.
 */

const DB_NAME = 'faceverify'
const DB_VERSION = 1
const STORE_KV = 'kv'
const STORE_BLOBS = 'blobs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser mode.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV)
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'))
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab.'))
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

export const idbGet = <T>(key: string): Promise<T | undefined> => tx<T | undefined>(STORE_KV, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
export const idbSet = <T>(key: string, value: T): Promise<IDBValidKey> => tx(STORE_KV, 'readwrite', (s) => s.put(value, key))

export const idbGetBlob = (key: string): Promise<Blob | undefined> =>
  tx<Blob | undefined>(STORE_BLOBS, 'readonly', (s) => s.get(key) as IDBRequest<Blob | undefined>)
export const idbSetBlob = (key: string, value: Blob): Promise<IDBValidKey> =>
  tx(STORE_BLOBS, 'readwrite', (s) => s.put(value, key))
export const idbDeleteBlob = (key: string): Promise<undefined> => tx(STORE_BLOBS, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>)

export const KV_KEYS = {
  avatarMeta: 'avatar:meta',
  prefs: 'prefs',
} as const

export const BLOB_KEYS = {
  avatarGlb: 'avatar:glb',
  faceTexture: 'avatar:face-texture',
} as const

/**
 * Wipe every trace of the user's face from this device: IndexedDB (both stores),
 * localStorage preferences, and the Cache Storage entries the service worker created.
 */
export async function deleteAllUserData(): Promise<{ clearedCaches: number }> {
  const db = await openDb().catch(() => null)
  if (db) {
    await new Promise<void>((resolve) => {
      const t = db.transaction([STORE_KV, STORE_BLOBS], 'readwrite')
      t.objectStore(STORE_KV).clear()
      t.objectStore(STORE_BLOBS).clear()
      t.oncomplete = () => resolve()
      t.onerror = () => resolve()
      t.onabort = () => resolve()
    })
  }

  try {
    localStorage.clear()
  } catch {
    /* storage may be blocked in private mode */
  }

  let clearedCaches = 0
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(
        names.map(async (name) => {
          // Keep the app shell so the PWA still opens offline; drop everything else.
          if (name.includes('precache') || name.includes('workbox')) return
          await caches.delete(name)
          clearedCaches++
        }),
      )
    }
  } catch {
    /* caches API may be unavailable */
  }

  return { clearedCaches }
}

/** Approximate bytes currently used by this origin, for the storage readout. */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const e = await navigator.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}

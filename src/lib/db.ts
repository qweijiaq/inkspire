/** 极简 IndexedDB 封装：docs / settings / assets 三个 store */

const DB_NAME = 'inkspire'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'path' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const idb = {
  getAll<T>(store: string): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
  },
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
  },
  put(store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return tx<IDBValidKey>(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)))
  },
  del(store: string, key: IDBValidKey): Promise<undefined> {
    return tx<undefined>(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>)
  },
  clear(store: string): Promise<undefined> {
    return tx<undefined>(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>)
  },
}

/** 极简 IndexedDB 封装：docs / settings / assets 三个 store */

const DB_NAME = 'inkspire'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
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
    req.onblocked = () => reject(new Error('IndexedDB 被其他窗口阻塞'))
  })
  dbPromise = pending
  // 打开失败会永久缓存 rejected Promise；本次会话后续读写会全部失败。
  pending.catch(() => {
    if (dbPromise === pending) dbPromise = null
  })
  return pending
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T | undefined
        let requestDone = false
        let settled = false
        const fail = (err: unknown) => {
          if (settled) return
          settled = true
          reject(err instanceof Error ? err : new Error(String(err ?? 'IndexedDB 事务失败')))
        }
        try {
          const t = db.transaction(store, mode)
          const req = fn(t.objectStore(store))
          req.onsuccess = () => {
            result = req.result
            requestDone = true
          }
          req.onerror = () => fail(req.error)
          // 写事务的 request success 早于真正提交；必须等 oncomplete，配额错误会在 commit 阶段 abort。
          t.oncomplete = () => {
            if (settled) return
            if (!requestDone) {
              fail(new Error('IndexedDB 事务未返回结果'))
              return
            }
            settled = true
            resolve(result as T)
          }
          t.onabort = () => fail(t.error ?? new Error('IndexedDB 事务已中止'))
          t.onerror = () => fail(t.error ?? new Error('IndexedDB 事务错误'))
        } catch (err) {
          fail(err)
        }
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

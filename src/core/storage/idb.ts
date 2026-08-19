// Tiny hand-rolled IndexedDB wrapper for a single fixed-key record — used by
// idbChannelStore.ts (the large cached Channel[]) and
// channelIdentityResolutionCache.ts (the identity resolver's cross-session
// result cache). Deliberately NOT a general KV abstraction: each consumer
// gets its own small named database with exactly one object store holding
// exactly one record. Values are stored via structured clone directly
// (IDBObjectStore.put), never JSON.stringify/parse, so neither consumer does
// large synchronous JSON work on the UI thread — the whole point of moving
// these off localStorage in the first place.
//
// Every operation is defensive, mirroring localStore.ts's
// try/catch-everywhere contract: unavailable/blocked/failed IndexedDB never
// throws back to the caller — read() resolves null, write()/clear() resolve
// false. clear() specifically waits for the delete transaction's
// `oncomplete` (or resolves false on `onerror`/`onabort`) — never a
// fire-and-forget `.delete()` call, since callers depend on knowing a clear
// genuinely completed before treating storage as empty.

const RECORD_KEY = 'record'

export interface IdbSingleRecordStore<T> {
  read(): Promise<T | null>
  write(value: T): Promise<boolean>
  clear(): Promise<boolean>
}

export function openSingleRecordStore<T>(dbName: string, storeName: string, dbVersion = 1): IdbSingleRecordStore<T> {
  if (typeof indexedDB === 'undefined') {
    return {
      read: async () => null,
      write: async () => false,
      clear: async () => false,
    }
  }

  let dbPromise: Promise<IDBDatabase> | null = null

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.open(dbName, dbVersion)
      } catch (err) {
        reject(err)
        return
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error(`IndexedDB open blocked for "${dbName}"`))
    })
    // Self-heal: a transient failure (e.g. one blocked open) shouldn't
    // permanently disable this store for the rest of the session — the next
    // call gets a fresh attempt instead of a cached rejection forever.
    dbPromise.catch(() => {
      dbPromise = null
    })
    return dbPromise
  }

  async function read(): Promise<T | null> {
    try {
      const db = await openDb()
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly')
        const request = tx.objectStore(storeName).get(RECORD_KEY)
        request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      console.warn(`[idb] read failed for "${dbName}/${storeName}" — treating as empty.`, err)
      return null
    }
  }

  async function write(value: T): Promise<boolean> {
    try {
      const db = await openDb()
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).put(value, RECORD_KEY)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      })
    } catch (err) {
      console.warn(`[idb] write failed for "${dbName}/${storeName}".`, err)
      return false
    }
  }

  async function clear(): Promise<boolean> {
    try {
      const db = await openDb()
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(RECORD_KEY)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      })
    } catch (err) {
      console.warn(`[idb] clear failed for "${dbName}/${storeName}".`, err)
      return false
    }
  }

  return { read, write, clear }
}

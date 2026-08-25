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

// Same defensive contract as IdbSingleRecordStore, but with a caller-chosen
// key per record — the multi-playlist channel cache (see
// storage/idbPlaylistChannelStore.ts) needs one independently
// readable/writable/deletable record PER playlist, so resyncing or removing
// playlist B never rewrites or endangers playlist A's (potentially 30,000-
// channel) record. Deliberately still not a general KV abstraction: no
// indexes, no cursors over values, no partial updates — just the four
// operations that per-playlist atomicity actually needs.
export interface IdbKeyedRecordStore<T> {
  read(key: string): Promise<T | null>
  write(key: string, value: T): Promise<boolean>
  remove(key: string): Promise<boolean>
  // Every key currently present. Used to prune records orphaned by an
  // external storage reset (e.g. the dev AdminPanel's localStorage-only
  // wipe) — never to enumerate playlists, which the (tiny, synchronous)
  // library index in localStorage is the source of truth for.
  keys(): Promise<string[]>
}

// Shared, lazily-opened connection for one (dbName, storeName) pair. Split
// out of openSingleRecordStore so openKeyedRecordStore below reuses the
// exact same open/upgrade/self-heal behaviour rather than a second copy of
// it that could drift.
function createDbOpener(dbName: string, storeName: string, dbVersion: number): () => Promise<IDBDatabase> {
  let dbPromise: Promise<IDBDatabase> | null = null
  return function openDb(): Promise<IDBDatabase> {
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
}

export function openSingleRecordStore<T>(dbName: string, storeName: string, dbVersion = 1): IdbSingleRecordStore<T> {
  if (typeof indexedDB === 'undefined') {
    return {
      read: async () => null,
      write: async () => false,
      clear: async () => false,
    }
  }

  const openDb = createDbOpener(dbName, storeName, dbVersion)

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

// Multi-record sibling of openSingleRecordStore — one object store, many
// caller-keyed records. Every operation is scoped to a single key and runs
// in its own transaction, which is what makes "replace playlist B's cached
// channels" genuinely atomic with respect to playlist A: A's record is
// never read, rewritten or held open by B's write, so a failure mid-resync
// can only ever leave B untouched.
export function openKeyedRecordStore<T>(dbName: string, storeName: string, dbVersion = 1): IdbKeyedRecordStore<T> {
  if (typeof indexedDB === 'undefined') {
    return {
      read: async () => null,
      write: async () => false,
      remove: async () => false,
      keys: async () => [],
    }
  }

  const openDb = createDbOpener(dbName, storeName, dbVersion)

  async function read(key: string): Promise<T | null> {
    try {
      const db = await openDb()
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly')
        const request = tx.objectStore(storeName).get(key)
        request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      console.warn(`[idb] read failed for "${dbName}/${storeName}/${key}" — treating as empty.`, err)
      return null
    }
  }

  async function write(key: string, value: T): Promise<boolean> {
    try {
      const db = await openDb()
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).put(value, key)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      })
    } catch (err) {
      console.warn(`[idb] write failed for "${dbName}/${storeName}/${key}".`, err)
      return false
    }
  }

  async function remove(key: string): Promise<boolean> {
    try {
      const db = await openDb()
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(key)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      })
    } catch (err) {
      console.warn(`[idb] delete failed for "${dbName}/${storeName}/${key}".`, err)
      return false
    }
  }

  async function keys(): Promise<string[]> {
    try {
      const db = await openDb()
      return await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly')
        const request = tx.objectStore(storeName).getAllKeys()
        request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String))
        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      console.warn(`[idb] key listing failed for "${dbName}/${storeName}".`, err)
      return []
    }
  }

  return { read, write, remove, keys }
}

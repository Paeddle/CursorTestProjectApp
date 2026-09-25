import { normalizePunch, type Punch } from './types'

const DB_NAME = 'timeclock'
const STORE = 'punches'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadPunches(): Promise<Punch[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).getAll()
    request.onsuccess = () =>
      resolve(((request.result as Punch[]) ?? []).map((punch) => normalizePunch(punch)))
    request.onerror = () => reject(request.error)
  })
}

export async function savePunch(punch: Punch): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(punch)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function savePunches(punches: Punch[]): Promise<void> {
  if (punches.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const punch of punches) store.put(punch)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

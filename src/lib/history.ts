/** 导入历史记录：视频/音频文件本体存入 IndexedDB，下次可直接打开，无需重新选择文件 */

const DB_NAME = 'smart-repeater'
const STORE = 'files'
const MAX_ITEMS = 30
/** 总容量上限（字节），超出后按最旧优先清理 */
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024

export interface HistoryMeta {
  id: string
  name: string
  size: number
  addedAt: number
  type: string
}

export interface HistoryRecord extends HistoryMeta {
  blob: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 保存文件到历史记录（自动清理超出数量的旧条目） */
export async function saveToHistory(blob: Blob, name: string, type: string): Promise<HistoryMeta | null> {
  try {
    const db = await openDb()
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const rec: HistoryRecord = { id, name, size: blob.size, addedAt: Date.now(), type, blob }
    await tx(db, 'readwrite', (s) => s.put(rec))
    // 数量与容量清理
    const all = ((await tx(db, 'readonly', (s) => s.getAll())) as HistoryRecord[]).sort((a, b) => b.addedAt - a.addedAt)
    let total = all.reduce((sum, r) => sum + r.size, 0)
    const stale: string[] = []
    for (let i = MAX_ITEMS; i < all.length; i++) stale.push(all[i].id)
    for (const r of all) {
      if (total <= MAX_TOTAL_BYTES && stale.length >= all.length - MAX_ITEMS) break
      if (stale.includes(r.id)) {
        total -= r.size
        continue
      }
      if (total > MAX_TOTAL_BYTES) {
        stale.push(r.id)
        total -= r.size
      }
    }
    for (const sid of stale) {
      await tx(db, 'readwrite', (s) => s.delete(sid))
    }
    db.close()
    return { id, name, size: blob.size, addedAt: Date.now(), type }
  } catch {
    return null
  }
}

/** 历史列表（不含文件本体，按时间倒序） */
export async function listHistory(): Promise<HistoryMeta[]> {
  try {
    const db = await openDb()
    const all = (await tx(db, 'readonly', (s) => s.getAll())) as HistoryRecord[]
    db.close()
    return all
      .map(({ blob: _b, ...meta }) => meta)
      .sort((a, b) => b.addedAt - a.addedAt)
  } catch {
    return []
  }
}

/** 读取历史文件本体 */
export async function getHistoryFile(id: string): Promise<HistoryRecord | null> {
  try {
    const db = await openDb()
    const rec = (await tx(db, 'readonly', (s) => s.get(id))) as HistoryRecord | undefined
    db.close()
    return rec ?? null
  } catch {
    return null
  }
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    const db = await openDb()
    await tx(db, 'readwrite', (s) => s.delete(id))
    db.close()
  } catch {
    /* ignore */
  }
}

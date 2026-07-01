// IndexedDB storage for custom video backgrounds (colors and base64 images).
const DB_NAME = "chat_story_bgs_db";
const STORE = "backgrounds";
const VERSION = 1;

export type StoredBackground = {
  id: string;
  type: "color" | "image" | "video";
  value: string; // hex color or base64 data URL
  createdAt: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBackground(b: StoredBackground): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(b);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function listBackgrounds(): Promise<StoredBackground[]> {
  const db = await openDB();
  const result = await new Promise<StoredBackground[]>((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result as StoredBackground[]);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteBackground(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

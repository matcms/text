// Minimal IndexedDB wrapper for persisting Chat Story projects (with audio Blobs).
const DB_NAME = "chat_story_db";
const STORE = "projects";
const VERSION = 1;

export type StoredMsg =
  | {
      id: number;
      side: string;
      type: "text";
      voiceName: string;
      text: string;
      audioBlob: Blob | null;
    }
  | {
      id: number;
      side: string;
      type: "image";
      text: string;
      imageBlob: Blob | null;
    }
  | {
      id: number;
      side: string;
      type: "video";
      text: string;
      videoBlob: Blob | null;
      videoType: "mp4" | "gif" | null;
    };

export type StoredChat = {
  id: string;
  name: string;
  contactName: string;
  contactPhotoBlob: Blob | null;
  headerTime: string;
  script: string;
  messages: StoredMsg[];
  voiceMap: Record<string, string>;
  characterPhotos?: Record<string, string>;
};

export type StoredAudio = {
  voiceName: string;
  text: string;
  audioBlob: Blob | null;
};

export type StoredProject = {
  id: string;
  projectName: string;
  theme: "imessage" | "whatsapp";
  isGroupChat: boolean;
  messageDelay: number;
  chats: StoredChat[];
  createdAt: number;
  audioLibrary?: StoredAudio[];
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

export async function saveProject(p: StoredProject): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(p);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function listProjects(): Promise<StoredProject[]> {
  const db = await openDB();
  const result = await new Promise<StoredProject[]>((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result as StoredProject[]);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function urlToBlob(url: string | null): Promise<Blob | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    return await r.blob();
  } catch {
    return null;
  }
}

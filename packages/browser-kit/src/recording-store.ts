import type { CaptureManifest } from "./capture-bundle.js";

/**
 * A finished recording, handed from the recorder to the render page.
 *
 * IndexedDB (not storage.local) because a continuous-video capture is a large
 * Blob and screenshot sets are many MB — IDB stores Blobs natively, is shared
 * across the extension's pages, and survives service-worker eviction.
 */
export interface StoredRecordingRecord {
  id?: string;
  createdAt?: number;
  title: string;
  mode: "screenshot" | "video";
  manifest: CaptureManifest;
  /** screenshot mode: one PNG data URL per frame. */
  images?: string[];
}

const DB_NAME = "demoscope";
const STORE = "kv";
const ACTIVE_RECORD_KEY = "active-recording";
const HISTORY_KEY = "recording-history";
const LEGACY_RECORD_KEY = "recording";
const LEGACY_VIDEO_KEY = "video";

export interface RecordingListItem {
  id: string;
  title: string;
  mode: StoredRecordingRecord["mode"];
  createdAt: number;
  frameCount: number;
}

const recordKey = (id: string) => `recording:${id}`;
const videoKey = (id: string) => `video:${id}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function del(...keys: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const key of keys) tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Recorder side: archive a finished recording and make it the active one. */
export async function saveRecordingRecord(
  record: StoredRecordingRecord
): Promise<string> {
  const id = crypto.randomUUID();
  const saved = { ...record, id, createdAt: Date.now() };
  await put(recordKey(id), saved);
  if (record.mode === "video") {
    const blob = await get<Blob>(LEGACY_VIDEO_KEY);
    if (blob) await put(videoKey(id), blob);
  }
  const history = await listRecordings();
  await put(HISTORY_KEY, [
    {
      id,
      title: saved.title,
      mode: saved.mode,
      createdAt: saved.createdAt,
      frameCount: saved.manifest.frames.length,
    },
    ...history,
  ]);
  await put(ACTIVE_RECORD_KEY, id);
  return id;
}

/** Offscreen side: store the captured video blob (video mode only). */
export const saveVideoBlob = (blob: Blob) => put(LEGACY_VIDEO_KEY, blob);

/** Render side: read the recording metadata. */
export async function loadRecordingRecord(): Promise<
  StoredRecordingRecord | undefined
> {
  const activeId = await get<string>(ACTIVE_RECORD_KEY);
  if (activeId) return get<StoredRecordingRecord>(recordKey(activeId));
  return get<StoredRecordingRecord>(LEGACY_RECORD_KEY);
}

/** Render side: read the captured video blob. */
export async function loadVideoBlob(): Promise<Blob | undefined> {
  const activeId = await get<string>(ACTIVE_RECORD_KEY);
  return activeId ? get<Blob>(videoKey(activeId)) : get<Blob>(LEGACY_VIDEO_KEY);
}

export const listRecordings = async (): Promise<RecordingListItem[]> =>
  (await get<RecordingListItem[]>(HISTORY_KEY)) ?? [];

/** Render side: which recording is currently active (drives library highlight). */
export const getActiveRecordingId = (): Promise<string | undefined> =>
  get<string>(ACTIVE_RECORD_KEY);

export const selectRecording = (id: string) => put(ACTIVE_RECORD_KEY, id);

export async function renameRecording(
  id: string,
  title: string
): Promise<void> {
  const nextTitle = title.trim();
  const record = await get<StoredRecordingRecord>(recordKey(id));
  if (!record || !nextTitle || record.title === nextTitle) return;
  await put(recordKey(id), { ...record, title: nextTitle });
  const history = await listRecordings();
  await put(
    HISTORY_KEY,
    history.map((item) =>
      item.id === id ? { ...item, title: nextTitle } : item
    )
  );
}

export async function deleteRecording(id: string): Promise<void> {
  const history = await listRecordings();
  const remaining = history.filter((record) => record.id !== id);
  await del(
    recordKey(id),
    videoKey(id),
    editKey(id, "video"),
    editKey(id, "document")
  );
  await put(HISTORY_KEY, remaining);
  const activeId = await get<string>(ACTIVE_RECORD_KEY);
  if (activeId === id) {
    if (remaining[0]) await put(ACTIVE_RECORD_KEY, remaining[0].id);
    else await del(ACTIVE_RECORD_KEY);
  }
}

/** Remove legacy transient keys retained for backwards-compatible migration. */
export const clearRecording = () => del(LEGACY_RECORD_KEY, LEGACY_VIDEO_KEY);

// --- edit persistence -------------------------------------------------------
//
// Each recording carries an *edit document* per editor kind (video / step
// document): the live `working` copy that autosaves on every change, plus any
// named `versions` the user snapshots. The auto-derived default is never stored
// here — it is always re-derivable from the capture manifest, so it can neither
// be lost nor go stale.

/** A recording's editor kinds. Kept string-typed to stay payload-agnostic. */
export type EditKind = "video" | "document";

/** One named snapshot of an edit model. */
export interface EditVersion<T> {
  id: string;
  name: string;
  createdAt: number;
  model: T;
}

/** The persisted edit state for one recording + kind. */
export interface EditDoc<T> {
  working: T;
  versions: EditVersion<T>[];
}

const editKey = (id: string, kind: EditKind) => `edits:${id}:${kind}`;

// Pure reducers over an edit document — exported so they can be reused and unit
// tested without a live IndexedDB.

export const withWorking = <T>(
  doc: EditDoc<T> | undefined,
  working: T
): EditDoc<T> => ({
  working,
  versions: doc?.versions ?? [],
});

export const withNewVersion = <T>(
  doc: EditDoc<T> | undefined,
  version: EditVersion<T>
): EditDoc<T> => ({
  working: doc?.working ?? version.model,
  versions: [version, ...(doc?.versions ?? [])],
});

export const withoutVersion = <T>(
  doc: EditDoc<T>,
  versionId: string
): EditDoc<T> => ({
  working: doc.working,
  versions: doc.versions.filter((version) => version.id !== versionId),
});

export const withRenamedVersion = <T>(
  doc: EditDoc<T>,
  versionId: string,
  name: string
): EditDoc<T> => ({
  working: doc.working,
  versions: doc.versions.map((version) =>
    version.id === versionId ? { ...version, name } : version
  ),
});

export const loadEditDoc = <T>(
  id: string,
  kind: EditKind
): Promise<EditDoc<T> | undefined> => get<EditDoc<T>>(editKey(id, kind));

/** Autosave the live working copy, preserving any existing versions. */
export async function saveWorkingEdit<T>(
  id: string,
  kind: EditKind,
  working: T
): Promise<void> {
  const doc = await loadEditDoc<T>(id, kind);
  await put(editKey(id, kind), withWorking(doc, working));
}

/** Snapshot `model` as a new named version (newest first). Returns it. */
export async function saveEditVersion<T>(
  id: string,
  kind: EditKind,
  name: string,
  model: T
): Promise<EditVersion<T>> {
  const doc = await loadEditDoc<T>(id, kind);
  const version: EditVersion<T> = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    model,
  };
  await put(editKey(id, kind), withNewVersion(doc, version));
  return version;
}

export async function deleteEditVersion(
  id: string,
  kind: EditKind,
  versionId: string
): Promise<void> {
  const doc = await loadEditDoc<unknown>(id, kind);
  if (!doc) return;
  await put(editKey(id, kind), withoutVersion(doc, versionId));
}

export async function renameEditVersion(
  id: string,
  kind: EditKind,
  versionId: string,
  name: string
): Promise<void> {
  const nextName = name.trim();
  const doc = await loadEditDoc<unknown>(id, kind);
  if (!doc || !nextName) return;
  await put(editKey(id, kind), withRenamedVersion(doc, versionId, nextName));
}

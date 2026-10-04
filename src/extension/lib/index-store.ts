// The repo index in IndexedDB, one record per repo: the same JSON the Node script writes to data/index.json.
// M3 splits it into per-table stores when memory arrives; for now one record keeps it simple.

import type { RepoIndex } from "../../index/types.ts";

const DB = "cairn";
const STORE = "indexes";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function getIndex(repo: string): Promise<RepoIndex | undefined> {
  return run("readonly", (store) => store.get(repo) as IDBRequest<RepoIndex | undefined>);
}

export async function putIndex(index: RepoIndex): Promise<void> {
  await run("readwrite", (store) => store.put(index, index.meta.repo));
}

export async function deleteIndex(repo: string): Promise<void> {
  await run("readwrite", (store) => store.delete(repo));
}

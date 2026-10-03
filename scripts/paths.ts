// Where the Node scripts keep their files. Paths are relative to the project root,
// which is the working directory under `npm run` and Vitest.

export const INDEX_PATH = "data/index.json";
export const CACHE_DIR = "data/cache";

/** Zips are cached per commit, so a new commit downloads a fresh copy. */
export function zipCachePath(repo: string, commit: string): string {
  return `${CACHE_DIR}/${repo.replace("/", "-")}-${commit}.zip`;
}

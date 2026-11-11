// Only preferences cross visits. Scene, browsing position and developing progress stay in memory.
export const viewerLikesKey = (albumId: string, preview = false) =>
  `roll-for-us:viewer-likes:v1:${preview ? "preview:" : "album:"}${encodeURIComponent(albumId)}`;

type LikesStorage = Pick<Storage, "getItem" | "setItem">;

export function loadViewerLikes(albumId: string, photoIds: Iterable<string>, preview = false, storage?: LikesStorage): string[] {
  try {
    const raw = (storage ?? localStorage).getItem(viewerLikesKey(albumId, preview));
    if (!raw) return [];
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return [];
    const record = saved as Record<string, unknown>;
    if (record.version !== 1 || record.albumId !== albumId || !Array.isArray(record.likedPhotoIds)
      || !record.likedPhotoIds.every((id): id is string => typeof id === "string")) return [];
    const available = new Set(photoIds);
    return [...new Set(record.likedPhotoIds)].filter(id => available.has(id));
  } catch {
    // Blocked storage or malformed records must never prevent opening the letter.
    return [];
  }
}

export function saveViewerLikes(albumId: string, likedPhotoIds: readonly string[], preview = false, storage?: LikesStorage): void {
  try {
    (storage ?? localStorage).setItem(viewerLikesKey(albumId, preview), JSON.stringify({
      version: 1, albumId, likedPhotoIds: [...new Set(likedPhotoIds)],
    }));
  } catch {
    // The current visit still works when storage is blocked or its quota is exhausted.
  }
}

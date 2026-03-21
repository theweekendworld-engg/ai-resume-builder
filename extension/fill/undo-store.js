export const FILL_UNDO_KEY_PREFIX = 'fill-undo:';

export function getUndoStorageKey(tabId) {
  return `${FILL_UNDO_KEY_PREFIX}${tabId}`;
}

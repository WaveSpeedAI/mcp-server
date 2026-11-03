// delete_predictions: the checks and the report around POST /api/v3/predictions/delete.
// The API only touches the key's own organization and returns the ids it deleted. Deleting is a soft
// delete: the record stays, with status "deleted" and no outputs.

import { checkPredictionId } from './ids.js';

export const MAX_DELETE_IDS = 100;

/** The ids to send: trimmed, unique, valid, and only once the user agreed (confirm). */
export function prepareDelete(ids: string[], confirm: boolean): string[] {
  const unique: string[] = [];
  for (const raw of ids) {
    const id = checkPredictionId(raw);
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length === 0 || unique.length > MAX_DELETE_IDS) {
    throw new Error(`Pass between 1 and ${MAX_DELETE_IDS} prediction ids.`);
  }
  if (!confirm) {
    throw new Error(
      `Nothing was deleted. This marks ${unique.length} prediction(s) as deleted (their outputs are no longer returned) and cannot be undone here: ask the user, then call again with confirm: true.`,
    );
  }
  return unique;
}

export function summarizeDelete(requested: string[], deletedIds: string[] | undefined) {
  const deleted = deletedIds ?? [];
  const notDeleted = requested.filter((id) => !deleted.includes(id));
  return {
    deleted,
    deleted_count: deleted.length,
    requested: requested.length,
    ...(notDeleted.length > 0
      ? { not_deleted: notDeleted, note: "These ids were not deleted: they are not in this account's history, are still running, or were already deleted." }
      : {}),
  };
}

/**
 * The handle an editor (video or step document) hands up to the app shell so it
 * can guard navigation: is there unsaved work, and please persist it.
 */
export interface EditorController {
  isDirty: () => boolean;
  save: () => Promise<void>;
}

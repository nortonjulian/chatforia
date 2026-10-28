/**
 * Preserve canonical private storage references when an upload completes.
 * Public URLs are retained only for legacy or external attachments.
 */
export function privateAttachmentReference(file) {
  return file?.key || file?.url || null;
}

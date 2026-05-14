/**
 * Attachment encoding for chat messages.
 *
 * We embed attachments inside the existing `messages.content` text column
 * using a self-describing marker so we don't need a schema change. The
 * marker format is:
 *
 *   [[ATTACH|<url>|<name>|<mime>]]
 *
 * Multiple markers may appear in a single message; remaining text outside
 * the markers is the human-typed body.
 */

const MARKER = /\[\[ATTACH\|([^|\]]+)\|([^|\]]*)\|([^|\]]*)\]\]/g;

export type ParsedAttachment = {
  url: string;
  name: string;
  mime: string;
};

export type ParsedMessage = {
  text: string;
  attachments: ParsedAttachment[];
};

/** Build a marker fragment to append to `content`. */
export function encodeAttachment(att: ParsedAttachment): string {
  // Sanitise pipe + bracket chars so the marker stays parseable
  const safe = (s: string) => s.replace(/[|\]\[]/g, '_');
  return `[[ATTACH|${att.url}|${safe(att.name)}|${safe(att.mime)}]]`;
}

/** Parse a stored message content into plain text + extracted attachments. */
export function parseMessageContent(content: string): ParsedMessage {
  const attachments: ParsedAttachment[] = [];
  const text = (content || '').replace(MARKER, (_m, url, name, mime) => {
    attachments.push({ url, name: name || 'attachment', mime: mime || 'application/octet-stream' });
    return '';
  }).trim();
  return { text, attachments };
}

export function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime);
}
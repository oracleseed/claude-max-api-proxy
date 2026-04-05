/**
 * Message Differ — compares incoming messages against sent history
 * to determine what's new (delta) vs what needs a full reset.
 */

interface Message {
  role: string;
  content: string | unknown[];
}

/**
 * Lightweight hash of a message for fast comparison.
 * System messages use first 200 chars (tolerates dynamic suffix injection).
 * Other messages use first 100 chars.
 */
export function hashMessage(msg: Message): string {
  let content: string;
  if (typeof msg.content === "string") {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = (msg.content as any[])
      .filter((c) => c && c.type === "text")
      .map((c) => c.text || "")
      .join("");
  } else {
    content = String(msg.content ?? "");
  }

  const maxChars = msg.role === "system" ? 200 : 100;
  return `${msg.role}:${content.slice(0, maxChars)}`;
}

/**
 * Find where incoming messages diverge from what was last sent.
 *
 * Returns:
 *  -1 = reset needed (incoming shorter or content mismatch)
 *   0 = first request (no lastSent)
 *   N = delta starts at index N
 */
export function findDivergencePoint(
  incoming: Message[],
  lastSent: Message[]
): number {
  if (lastSent.length === 0) return 0;

  for (let i = 0; i < lastSent.length; i++) {
    if (i >= incoming.length) return -1;
    if (hashMessage(incoming[i]) !== hashMessage(lastSent[i])) return -1;
  }

  return lastSent.length;
}

/**
 * Extract only user messages from the delta portion.
 * Assistant messages are skipped — CLI session already has them.
 */
export function extractDelta(
  incoming: Message[],
  divergeIndex: number
): Message[] {
  return incoming.slice(divergeIndex).filter((m) => m.role === "user");
}

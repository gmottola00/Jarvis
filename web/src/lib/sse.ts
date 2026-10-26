/**
 * Server-sent events over `fetch`.
 *
 * `EventSource` only issues GET requests, and both streaming endpoints are POST
 * (one carries a message, the other a decision), so the stream is parsed by
 * hand off the response body.
 *
 * The framing is handled properly rather than approximately, because it bit us
 * once: `sse-starlette` terminates lines with CRLF, so splitting frames on
 * "\n\n" silently matches nothing and the stream looks empty. The spec allows
 * CRLF, LF or bare CR as a line terminator, and this accepts all three - while
 * only consuming a separator it has seen in full, so a chunk boundary landing
 * inside "\r\n\r\n" does not split a frame in half.
 *
 * A `data:` line is only meaningful after an `event:` line. Anything else -
 * comments, the `:ping` keep-alives sent every 15 seconds - is skipped.
 */

/** A blank line in any of the three spec-legal terminator styles. */
const FRAME_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;
const LINE_SEPARATOR = /\r\n|\n|\r/;

import type { RunEvent } from "./types";

export interface StreamHandle {
  /** Stop reading and abort the request. */
  cancel: () => void;
  /** Resolves when the stream ends. */
  done: Promise<void>;
}

export function streamEvents(
  url: string,
  body: unknown,
  onEvent: (event: RunEvent) => void,
  onError?: (message: string) => void,
): StreamHandle {
  const controller = new AbortController();

  const done = (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted) onError?.(describe(error));
      return;
    }

    if (!response.ok || !response.body) {
      onError?.(`HTTP ${response.status} ${response.statusText}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        // Consume every frame terminated by a blank line; anything after the
        // last one - including a partial separator - stays buffered.
        for (;;) {
          const match = FRAME_SEPARATOR.exec(buffer);
          if (!match) break;
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const payload = parseFrame(frame);
          if (payload) onEvent(payload);
        }
      }

      // A final frame the server did not terminate before closing.
      const trailing = parseFrame(buffer);
      if (trailing) onEvent(trailing);
    } catch (error) {
      if (!controller.signal.aborted) onError?.(describe(error));
    } finally {
      reader.releaseLock();
    }
  })();

  return { cancel: () => controller.abort(), done };
}

function parseFrame(frame: string): RunEvent | null {
  let name: string | null = null;
  const dataLines: string[] = [];

  for (const line of frame.split(LINE_SEPARATOR)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!name || dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join("\n")) as RunEvent;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

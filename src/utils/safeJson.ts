// Crash-safe JSON.parse for UNTRUSTED input — localStorage
// markers a user or another tab may have corrupted, hand-edited / forged
// import files, and AI responses. Raw `JSON.parse` throws a SyntaxError on
// malformed input; a single unguarded parse in a startup path or an import
// flow takes the whole app down. `safeJsonParse` returns `fallback` on any
// failure (including a null/undefined source) instead of throwing.
//
// Use this ONLY where the input is untrusted / externally sourced. Parsing a
// value the app itself just stringified (e.g. `JSON.parse(JSON.stringify(x))`
// for a deep clone) can never throw and does not need it.
export function safeJsonParse<T = any>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (_e) {
    return fallback;
  }
}

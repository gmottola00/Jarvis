/**
 * A tiny JSON → YAML printer for the manifest viewer.
 *
 * The API server returns JSON; humans read manifests as YAML. This covers what a
 * Kubernetes object contains — maps, lists, scalars — and nothing else, which
 * is why it is twenty lines and not a dependency.
 */

const PLAIN = /^[A-Za-z0-9_./@:-][A-Za-z0-9_ ./@:=+-]*$/;
const AMBIGUOUS = /^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i;

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (text === "" || AMBIGUOUS.test(text) || !PLAIN.test(text) || text.endsWith(":")) return JSON.stringify(text);
  return text;
}

const isEmpty = (value: unknown) =>
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && value !== null && Object.keys(value).length === 0);

export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null && !isEmpty(item)) {
          // The first key shares the dash's line: `- name: web`.
          const body = toYaml(item, indent + 1).trimStart();
          return `${pad}- ${body}`;
        }
        return `${pad}- ${isEmpty(item) ? (Array.isArray(item) ? "[]" : "{}") : scalar(item)}`;
      })
      .join("\n");
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, child]) => {
        if (isEmpty(child)) return `${pad}${scalar(key)}: ${Array.isArray(child) ? "[]" : "{}"}`;
        if (typeof child === "object" && child !== null) {
          // Lists sit at the same indent as their key, as kubectl prints them.
          const nested = toYaml(child, Array.isArray(child) ? indent : indent + 1);
          return `${pad}${scalar(key)}:\n${nested}`;
        }
        return `${pad}${scalar(key)}: ${scalar(child)}`;
      })
      .join("\n");
  }

  return `${pad}${scalar(value)}`;
}

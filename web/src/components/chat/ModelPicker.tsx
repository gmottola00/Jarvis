import type { ModelCatalog } from "../../lib/types";

/**
 * Which model answers the next message. Claude and local models are grouped;
 * a local model whose GPU machine is off stays pickable and says who will
 * answer instead, because that is exactly what the backend will do. A local
 * model not yet in VRAM says so: its first answer waits for it to load.
 */
export function ModelPicker({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: ModelCatalog;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const claude = catalog.models.filter((m) => m.provider === "anthropic");
  const local = catalog.models.filter((m) => m.provider === "local");
  const picked = catalog.models.find((m) => m.id === value);
  const offline = picked?.provider === "local" && !picked.available;
  const cold = picked?.provider === "local" && picked.available && !picked.loaded;

  // Nothing to choose: hide rather than show a one-option menu.
  if (catalog.models.length < 2) return null;

  return (
    <select
      aria-label="Model"
      title={
        offline
          ? `GPU offline: ${catalog.fallback} will answer`
          : cold
            ? `${value} is not in VRAM yet: the first answer waits for it to load`
            : value
      }
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`max-w-[11rem] truncate rounded-lg border bg-ink-950 px-2 py-1.5 font-mono text-[11px] outline-none disabled:opacity-50 ${
        offline ? "border-amber-500/40 text-amber-300" : "border-ink-800 text-ink-400"
      }`}
    >
      <optgroup label="Claude">
        {claude.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </optgroup>
      {local.length > 0 && (
        <optgroup label="Local · GPU">
          {local.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id.replace(/^local\//, "")}
              {m.available ? (m.loaded ? " · loaded" : " · cold") : ` · offline → ${catalog.fallback}`}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

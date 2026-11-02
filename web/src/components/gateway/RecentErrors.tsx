import type { GatewayError } from "../../lib/console/types";
import { stamp } from "../../lib/format";
import { HudPanel, Quiet } from "../hud";

/** The latest failures, as LiteLLM classified them. The full request log stays in LiteLLM. */
export function RecentErrors({ errors, windowLabel }: { errors: GatewayError[]; windowLabel: string }) {
  return (
    <HudPanel title="Recent errors" note={windowLabel} flush>
      {errors.length === 0 ? (
        <div className="px-4 sm:px-5 py-3.5">
          <Quiet>No failed request in this window.</Quiet>
        </div>
      ) : (
        <ul className="divide-y divide-ink-850">
          {errors.map((e, index) => (
            <li key={`${e.at}-${index}`} className="grid gap-1 px-4 sm:px-5 py-2.5 font-mono text-[11px]">
              <p className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-amber-300">
                  {e.error_class || "error"}
                  {e.error_code && ` ${e.error_code}`}
                </span>
                <span className="text-ink-200">{e.model}</span>
                <span className="text-ink-500">{e.alias}</span>
                <span className="ml-auto text-ink-600">{stamp(e.at)}</span>
              </p>
              {e.message && (
                <p className="text-ink-500 [overflow-wrap:anywhere]" title={e.normalized_error}>
                  {e.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </HudPanel>
  );
}

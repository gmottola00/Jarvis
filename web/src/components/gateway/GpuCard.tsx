import type { Tone } from "../../lib/console/derive";
import { since } from "../../lib/format";
import type { GpuState } from "../../lib/types";
import { Aside, HudButton, HudCard, Leader, Quiet } from "../hud";
import { TONE } from "../ui/tone";
import { gb } from "./format";

export function GpuCard({ gpu, fallback, hasLocal }: { gpu: GpuState | null; fallback: string; hasLocal: boolean }) {
  if (!gpu) {
    return (
      <HudCard eyebrow="gpu node" title="not probed">
        <div className="px-6 pt-2 pb-5">
          <Aside>
            <span className="font-mono">JARVIS_OLLAMA_URL</span> is not set, so Jarvis cannot tell whether the GPU machine is on.
            {hasLocal && " Local models are listed as available, and a run to one fails with a gateway error if the machine is off."}
          </Aside>
        </div>
      </HudCard>
    );
  }

  const host = hostOf(gpu.url);
  const tone: Tone = gpu.up ? "ok" : "warn";
  const facts: [string, string, string][] = [
    ["ollama", gpu.url.replace(/^https?:\/\//, ""), "text-ink-300"],
    ["probe", "GET /api/ps · 1.5s timeout · cached 30s", "text-ink-500"],
    ["last probe", `${gpu.checked_at ? `${since(gpu.checked_at)} ago` : "—"} · ${gpu.up ? "200" : "no answer"}`, TONE[tone].text],
  ];

  return (
    <HudCard eyebrow="gpu node" title={host} note={<span className={TONE[tone].text}>{gpu.up ? "ollama answering" : "not answering"}</span>}>
      <div className="grid gap-5 px-6 pt-3.5 pb-5.5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {facts.map(([k, v, color]) => (
            <Leader key={k} label={k} value={<span className={color}>{v}</span>} />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ink-600 uppercase">in vram · /api/ps</span>
          {gpu.up ? (
            gpu.resident.length ? (
              <>
                {gpu.resident.map((r) => (
                  <Leader key={r.name} label={<span className="text-ink-200">{r.name}</span>} value={<span className="text-emerald-300">{gb(r.vram_bytes)}</span>} />
                ))}
                <Quiet>Loaded models answer at once. The others spend seconds loading first.</Quiet>
              </>
            ) : (
              <Quiet>Nothing loaded. The first call to a local model waits for it to load.</Quiet>
            )
          ) : (
            <p className="border border-dashed border-ink-800 px-3.5 py-3 text-[12.5px] leading-normal text-ink-500">
              Ollama does not answer. local/* show as offline, and a message sent to one asks before {fallback} answers it.
            </p>
          )}
          <div className="mt-1 flex items-center gap-2.5">
            <HudButton variant="ghost" disabled title="Not built yet">
              wake on lan
            </HudButton>
            <span className="font-mono text-[11px] text-ink-600">arrives with P2 · home__wake</span>
          </div>
        </div>
      </div>
    </HudCard>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

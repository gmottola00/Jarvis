import { useMemo } from "react";
import { consoleApi } from "../../lib/console/api";
import type { ManifestKind } from "../../lib/console/types";
import { usePolling } from "../../lib/hooks/usePolling";
import { toYaml } from "../../lib/yaml";
import { ErrorNote, Learn, Loading } from "../ui/primitives";

/** Top-level sections, coloured so `spec` (yours) and `status` (Kubernetes') read apart. */
const SECTION = /^(apiVersion|kind|metadata|spec|status|data|type):/;

/** `kubectl get -o yaml`, rendered. Fetched once per object; it is a snapshot, not a feed. */
export function ManifestViewer({ kind, namespace, name }: { kind: ManifestKind; namespace: string; name: string }) {
  const { data, error, loading } = usePolling(() => consoleApi.manifest(kind, namespace, name), 0, `${kind}/${namespace}/${name}`);
  const yaml = useMemo(() => (data ? toYaml(data) : ""), [data]);

  return (
    <div className="space-y-3 px-4 sm:px-5 py-4">
      <Learn topic="manifest" />
      {loading && <Loading label="reading from the API server…" />}
      <ErrorNote errors={error} />
      {yaml && (
        <pre className="overflow-x-auto rounded-lg border border-ink-850 bg-ink-950 px-4 py-3 font-mono text-[11px] leading-5 text-ink-400">
          {yaml.split("\n").map((line, index) => (
            <div key={index} className={SECTION.test(line) ? (line.startsWith("status") ? "text-amber-300/90" : "text-sky-300") : ""}>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

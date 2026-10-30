import { useEffect, useState } from "react";
import { LabPanel } from "../components/lab/LabPanel";
import { api } from "../lib/api";
import type { Capabilities, LabOverview } from "../lib/types";

const OVERVIEW_INTERVAL_MS = 15_000;

/** The lab at a glance: what used to sit next to the chat, now with room to breathe. */
export function Lab() {
  const [overview, setOverview] = useState<LabOverview | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .overview()
        .then((data) => alive && setOverview(data))
        .catch(() => undefined);
    load();
    api
      .capabilities()
      .then((data) => alive && setCapabilities(data))
      .catch(() => undefined);
    const timer = setInterval(load, OVERVIEW_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <LabPanel overview={overview} capabilities={capabilities} />
    </div>
  );
}

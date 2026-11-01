import { consoleApi } from "../../lib/console/api";
import type { PodDetail } from "../../lib/console/types";
import { usePolling } from "../../lib/hooks/usePolling";
import { HudPanel } from "../hud";
import { ErrorNote, Learn, LearnCommand, Loading } from "../ui/primitives";
import { EventFeed } from "./EventFeed";
import { NetworkMap } from "./NetworkMap";
import type { Select } from "./selection";

const EVENTS_MS = 15_000;
const NETWORK_MS = 15_000;

/** Events in one namespace (or all), polled only while mounted. */
export function NamespaceEvents({
  namespace,
  onObject,
  command,
}: {
  namespace: string;
  onObject: (namespace: string, ref: string) => void;
  /** The kubectl line learn mode shows above the list. */
  command?: string;
}) {
  const events = usePolling(() => consoleApi.events(namespace, 300), EVENTS_MS, namespace);
  return (
    <HudPanel title="Events" note={events.data ? `${events.data.length}` : undefined} topic="events">
      {command && <LearnCommand command={command} />}
      {events.loading && <Loading />}
      <ErrorNote errors={events.error} />
      {events.data && <EventFeed events={events.data} onObject={onObject} showNamespace={namespace === "all"} />}
    </HudPanel>
  );
}

/** Ingress → Service → Endpoints → Pod for one namespace (or all), polled only while mounted. */
export function NamespaceNetwork({ namespace, pods, onSelect }: { namespace: string; pods: PodDetail[]; onSelect: Select }) {
  const network = usePolling(() => consoleApi.network(namespace), NETWORK_MS, namespace);
  return (
    <>
      <Learn topic="service" />
      {network.loading && <Loading />}
      <ErrorNote errors={network.error} />
      {network.data && <NetworkMap network={network.data} pods={pods} onSelect={onSelect} />}
    </>
  );
}

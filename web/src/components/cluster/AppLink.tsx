import { isAppNamespace } from "../../lib/console/apps";
import { href } from "../../lib/route";

/** `app →`: from any pod or workload to the page of the app it belongs to. */
export function AppLink({ namespace, tab }: { namespace: string; tab?: string }) {
  if (!isAppNamespace(namespace)) return null;
  return (
    <a
      href={href("cluster", "apps", namespace, tab)}
      title={`Open the ${namespace} app page`}
      className="font-mono text-[10px] whitespace-nowrap text-sky-300 hover:text-sky-200"
    >
      {namespace} app →
    </a>
  );
}

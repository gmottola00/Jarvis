import { createContext, useContext, type ReactNode } from "react";
import { consoleApi } from "../console/api";
import type { StatusView } from "../console/types";
import { usePolling, type Polled } from "./usePolling";

/** Problems change on the scale of a probe period; this is also the sidebar badge refresh. */
export const STATUS_MS = 20_000;

const Context = createContext<Polled<StatusView> | null>(null);

/**
 * One `/api/status` poll for the whole shell: the status page renders it and
 * the sidebar badges count from it, so opening the page costs no extra request.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const status = usePolling(consoleApi.status, STATUS_MS);
  return <Context.Provider value={status}>{children}</Context.Provider>;
}

export function useStatus(): Polled<StatusView> {
  const value = useContext(Context);
  if (!value) throw new Error("useStatus outside StatusProvider");
  return value;
}

import { createContext, useContext, useState, type ReactNode } from "react";

const KEY = "jarvis.learn";

interface LearnMode {
  on: boolean;
  toggle: () => void;
}

const Context = createContext<LearnMode>({ on: false, toggle: () => undefined });

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether the console explains itself. On by default — this is a gym. */
export function LearnModeProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(stored);

  const toggle = () =>
    setOn((current) => {
      try {
        localStorage.setItem(KEY, current ? "off" : "on");
      } catch {
        /* private window: the switch still works, it just forgets */
      }
      return !current;
    });

  return <Context.Provider value={{ on, toggle }}>{children}</Context.Provider>;
}

export const useLearnMode = () => useContext(Context);

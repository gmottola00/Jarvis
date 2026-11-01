/**
 * Handing a prompt from a console page to the agent.
 *
 * The console pages look; the agent page acts. When a button on a console page
 * ("Investigate") wants the agent to take over, it leaves the prompt here and
 * switches tab. The dashboard picks it up on mount, opens a fresh session and
 * sends it, so the investigation is its own conversation rather than a tangent
 * in whatever was open before.
 *
 * sessionStorage, not state: the tabs unmount each other, and a reload in
 * between should not lose the click. The entry is removed only when the message
 * is actually sent, which keeps React StrictMode's double mount from eating it.
 */

const KEY = "jarvis.handoff";

export function askJarvis(prompt: string): void {
  try {
    sessionStorage.setItem(KEY, prompt);
  } catch {
    /* blocked storage: the tab still switches, the prompt is lost */
  }
  window.location.hash = "jarvis";
}

export function pendingHandoff(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearHandoff(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* as above */
  }
}

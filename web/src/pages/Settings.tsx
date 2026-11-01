import { Models } from "./Models";

/**
 * How Jarvis is wired: which models answer, the GPU host and the budget.
 * The tools it may call live with the agent, under Jarvis → tools.
 */
export function Settings() {
  return <Models />;
}

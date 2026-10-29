# Jarvis

An agent that operates the home lab. This is **P0 — "hands, no face"**: text only,
driven from a web console, exactly as scoped in `Home Lab Infrastructure Diagram.pdf`.

> Jarvis has no `kubectl apply` in its hands. It writes commits and opens pull
> requests against `Home-Lab-Infra` and the app repos; ArgoCD stays the only thing
> that changes the cluster, so every action Jarvis takes is diffable and revertible.

That is not a guideline, it is the architecture. There is no apply, patch, delete
or scale tool anywhere in this codebase, and a test asserts there never is.

---

## Prerequisites

- **Python 3.12** and [uv](https://docs.astral.sh/uv/) — the backend.
- **Node 22** — only to build the dashboard. Not installed on this machine yet:
  `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`,
  or use [nvm](https://github.com/nvm-sh/nvm).
- **Docker** — only for `make up`. The backend runs fine without it.

`web/dist/` is already built, so `make run-api` serves the dashboard on :8100
before Node is installed. Node is needed to change the dashboard.

## Quick start

Nothing below needs a cluster, a token, or even an API key to run.

```bash
make setup        # venv + dependencies + dashboard + .env
make run          # builds the dashboard, serves everything on :8100
```

Open <http://localhost:8100>. With `JARVIS_FAKE_TOOLS=true` (the default in
`.env.example`) every capability is served from fixtures that mirror the real lab,
so the dashboard populates and the deploy flow can be rehearsed offline.

Add `ANTHROPIC_API_KEY` to `.env` to enable chat.

**While developing**, two processes are nicer than one:

```bash
make run-api      # :8100, reloading
make run-web      # :5173, hot module reload, proxies /api to :8100
```

**The full stack**, with Postgres and Redis so suspended approvals survive a
restart:

```bash
make up           # dashboard on :8080
```

---

## How it works

```
router ──▶ model ──▶ gate ──▶ act ──┐
             ▲                       │
             └───────────────────────┘
             │
             └──▶ answer
```

- **router** — small talk gets no tools and low effort; everything else gets the
  full surface.
- **model** — Claude Opus 5 with adaptive thinking, streamed. The Anthropic SDK
  is confined to `agent/llm.py`; everything else talks to a protocol, which is
  how the whole graph is tested without an API key.
- **gate** — the one place a human is asked. Reads and writes pass; destructive
  calls suspend the run via LangGraph's `interrupt`, checkpointed to Postgres.
- **act** — cleared calls run concurrently and every result comes back in a
  single message.

The policy, from the design doc:

| risk | meaning | what happens |
|---|---|---|
| `read` | no side effects | runs immediately |
| `write` | commit or pull request — never the cluster | runs immediately |
| `destructive` | hard to reverse | suspends and asks |

`github__merge_pr` is destructive on purpose. Merging is what ships, and the design
doc is explicit that this gate never gets automated.

---

## Adding a capability

**This is where Jarvis grows.** Three steps, and nothing else changes — not the
graph, not the gate, not the API, not the dashboard.

```
src/jarvis/tools/<name>/
├── client.py    # typed async client; reads its token from Settings
├── fake.py      # same surface, static fixtures
├── tools.py     # the @tool functions + a ClientProvider
└── __init__.py  # exports TOOLS and provider
```

```python
@tool(namespace="home", risk=RiskLevel.WRITE)
async def wake(host: str) -> str:
    """Send a Wake-on-LAN packet.

    Args:
        host: The machine to wake, e.g. "desktop-5080".
    """
    return await provider.get().wol(host)
```

The JSON Schema is derived from the signature and the docstring, so that
`Args:` block becomes the parameter description the model reads. Then add the
module to `CAPABILITIES` in `src/jarvis/tools/__init__.py`. Done.

A capability may import from `jarvis.core`, `jarvis.settings` and `jarvis.tools` —
never from `jarvis.agent` or `jarvis.api`. That is what keeps lifting one out into
a standalone MCP server an adapter rather than a rewrite.

### What ships today

| namespace | tools | risk |
|---|---|---|
| `k8s` | `list_nodes` `list_pods` `get_logs` `list_events` `rollout_status` | read |
| `argocd` | `list_apps` `app_health` `app_diff` | read |
| `argocd` | `hard_refresh` | destructive |
| `ghcr` | `list_tags` `newest_green_tag` | read |
| `github` | `read_file` `list_prs` `check_runs` | read |
| `github` | `create_branch` `commit_file` `open_pr` | write |
| `github` | `set_replicas` (PR that sets `replicas` in the kustomization; apps in `JARVIS_REPLICAS_APPS` only) | write |
| `github` | `merge_pr` | destructive |
| `prometheus` | `query` `query_range` `pod_resources` `targets_down` | read |
| `loki` | `search` `query` | read |
| `alertmanager` | `list_alerts` | read |

---

## Layout

```
src/jarvis/
├── settings.py        pydantic-settings; every credential lives here
├── core/              protocols, value types, the policy gate — no I/O
├── tools/             one folder per capability
├── agent/             LangGraph: state, nodes, graph, runner, the model boundary
├── memory/            session history (Redis, or in-process)
├── observability/     run events and the audit log
└── api/               FastAPI: SSE chat, approvals, lab overview, runs

web/src/
├── lib/               types mirroring core/types.py, the SSE parser, REST calls
├── components/        chat, approval dialog, lab panel, run timeline
└── pages/Dashboard.tsx
```

---

## Configuration

Everything is `JARVIS_`-prefixed except `ANTHROPIC_API_KEY`. See `.env.example`.

Jarvis starts degraded rather than refusing to boot:

| missing | consequence |
|---|---|
| `ANTHROPIC_API_KEY` | chat says why; the dashboard still works |
| `JARVIS_DATABASE_URL` | in-memory checkpointer — a restart forgets pending approvals |
| `JARVIS_REDIS_URL` | in-process session history |
| capability tokens | that capability's tools return an error naming the variable to set |
| `JARVIS_LLM_GATEWAY_URL` | Claude only, straight to Anthropic; the model picker is hidden |
| `JARVIS_OLLAMA_URL` | local models always shown as available; the gateway's fallback still covers a dead GPU |
| `JARVIS_PROMETHEUS_URL` | `prometheus__*` tools return an error naming the variable; the rest of the agent is unaffected |
| `JARVIS_LOKI_URL` | `loki__*` tools likewise; `k8s__get_logs` still reads live containers |
| `JARVIS_ALERTMANAGER_URL` | the alerts page shows an error card; the dashboard's alert count is simply left out |

### Models and the LLM gateway

With `JARVIS_LLM_GATEWAY_URL` pointing at a LiteLLM proxy, every model call goes
through it and `ANTHROPIC_API_KEY` holds the proxy's virtual key, not the real
one. The chat gets a model picker fed by `GET /api/models`, which is whatever
that key may call:

- `claude-*` go through the proxy's Anthropic pass-through, so adaptive
  thinking, effort and the refusal fallback arrive untouched;
- `local/*` (Ollama on the GPU desktop) go through the proxy's `/v1/messages`,
  with a trimmed request. Their thinking is streamed but not kept in history,
  since a later Claude turn would reject an unsigned thinking block.

While the desktop is off, `local/*` show as offline and a message sent to one
is answered by `JARVIS_LOCAL_FALLBACK_MODEL` without waiting on a timeout. The
answering model is shown under each reply. In the cluster the proxy is
`apps/litellm` in Home-Lab-Infra; locally, `docker compose --profile gateway up`.

---

## Testing

```bash
make check        # black, isort, ruff, mypy --strict, pytest
make smoke-web    # the browser's SSE client, against a live backend
```

The graph tests drive a `ScriptedLLM` — a list of turns replayed in order — so
every assertion is about what the loop does, not about what a language model
happened to say. The API tests run the real ASGI app: routers, SSE encoding,
runner, graph, gate and checkpointer, all together.

`make smoke-web` covers the one seam Python cannot reach: the wire format as the
browser parses it. It earned its place — it caught a CRLF framing bug that every
Python test missed, because httpx normalises line endings and `fetch` does not.

---

## What comes next

Per the build order in the design deck:

- **P1 — voice.** Push-to-talk → Pipecat + whisper + Piper.
- **P2 — GPU on demand.** The desktop joins as a k3s agent, woken by WoL.
- **P3 — vision and gesture.**
- **P4 — autonomy.** `mcp-coder`, preview namespaces per PR.

Deploying Jarvis onto the cluster itself is mechanical once the flow works here:
`apps/jarvis/` with the usual seven files, `bootstrap/apps/jarvis.yaml`, secrets
sealed with `kubeseal --controller-namespace kube-system`, and an Ingress with
`ingressClassName: tailscale` and `tls.hosts: [jarvis]`.

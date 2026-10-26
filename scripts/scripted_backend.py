"""A Jarvis wired to a scripted model, for the web smoke test.

Exists so the browser's own SSE client can be run against a real server without
an API key. That is not a theoretical benefit: this is how the CRLF framing bug
in ``web/src/lib/sse.ts`` was found — the Python tests passed throughout, because
httpx normalises line endings and the browser does not.

    uvicorn scripts.scripted_backend:app --port 8101
"""

from __future__ import annotations

import os

os.environ.setdefault("JARVIS_FAKE_TOOLS", "true")

from jarvis.agent.llm import ScriptedLLM  # noqa: E402
from jarvis.api.app import create_app  # noqa: E402
from jarvis.core.types import RiskLevel  # noqa: E402

SCRIPT = [
    ScriptedLLM.call_many([("argocd__list_apps", {}), ("k8s__list_pods", {"only_unhealthy": True})]),
    ScriptedLLM.say("tickup is Degraded: tickup-web is in ImagePullBackOff."),
    ScriptedLLM.call("github__merge_pr", {"number": 12}, risk=RiskLevel.DESTRUCTIVE, text="Merging #12."),
    ScriptedLLM.say("Merged. ArgoCD will reconcile on its next poll."),
]

app = create_app(llm=ScriptedLLM(SCRIPT))

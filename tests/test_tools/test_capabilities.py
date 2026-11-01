"""The capabilities, against their fixtures."""

from __future__ import annotations

import pytest

from jarvis.tools import alertmanager, argocd, ghcr, github, k8s, loki, prometheus


class TestK8s:
    async def test_nodes(self) -> None:
        assert "um790" in await k8s.TOOLS[0]()

    async def test_only_unhealthy_filters(self) -> None:
        out = await k8s.tools.list_pods(only_unhealthy=True)
        assert "ImagePullBackOff" in out
        assert "trip-ai-backend" not in out


class TestArgoCD:
    async def test_degraded_app_is_flagged(self) -> None:
        out = await argocd.tools.list_apps()
        assert "tickup: Synced / Degraded" in out
        assert "needs attention" in out

    async def test_diff_reports_drift(self) -> None:
        assert "differ from Git" in await argocd.tools.app_diff(name="tickup")

    async def test_no_drift_is_stated_plainly(self) -> None:
        assert "no drift" in await argocd.tools.app_diff(name="trip-ai")


class TestGitHub:
    async def test_read_file(self) -> None:
        out = await github.tools.read_file(path="apps/tickup/kustomization.yaml")
        assert "newTag" in out

    async def test_green_and_not_green(self) -> None:
        green = await github.tools.check_runs(ref="c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a")
        red = await github.tools.check_runs(ref="e17b4c9d02fa63581e7d4a0b9c25f83716ade4b0")
        assert "GREEN" in green and "NOT GREEN" not in green
        assert "NOT GREEN" in red

    async def test_branch_commit_pr_round_trip(self) -> None:
        await github.tools.create_branch(branch="jarvis/test")
        await github.tools.commit_file(
            path="apps/tickup/kustomization.yaml", content="changed", message="test", branch="jarvis/test"
        )
        out = await github.tools.open_pr(head="jarvis/test", title="t", body="b")
        assert "Opened Home-Lab-Infra#" in out


class TestSetReplicas:
    async def test_opens_a_pr_that_stops_the_deployment(self) -> None:
        from jarvis.core.kustomize import parse_replicas

        out = await github.tools.set_replicas(
            app="tickup", component="backend", replicas=0, reason="OOMKilled 151 times in 24h"
        )
        assert "Opened Home-Lab-Infra#" in out and "only after merge" in out
        client = github.provider.get()
        pr = client._prs[-1]
        assert pr["title"] == "chore(tickup): stop backend"
        committed = client._branches[pr["head"]]["apps/tickup/kustomization.yaml"]
        assert parse_replicas(committed) == {"tickup-backend": 0}

    async def test_already_set_opens_nothing(self) -> None:
        client = github.provider.get()
        await github.tools.set_replicas(app="tickup", component="web", replicas=0, reason="broken image")
        await client.merge_pr("Home-Lab-Infra", client._prs[-1]["number"])
        before = len(client._prs)
        out = await github.tools.set_replicas(app="tickup", component="web", replicas=0, reason="again")
        assert "already set" in out
        assert len(client._prs) == before

    @pytest.mark.parametrize(
        "args, expected",
        [
            ({"app": "litellm", "component": "backend", "replicas": 0, "reason": "x"}, "not an app"),
            ({"app": "jarvis", "component": "backend", "replicas": 0, "reason": "x"}, "not an app"),
            ({"app": "tickup", "component": "backend", "replicas": 9, "reason": "x"}, "between 0 and 3"),
            ({"app": "tickup", "component": "backend", "replicas": 0, "reason": "  "}, "reason is required"),
        ],
    )
    async def test_refusals_are_error_results(self, registry, args, expected) -> None:
        from quaerium.agents import ToolCall

        result = await registry.invoke(ToolCall(id="x", name="github__set_replicas", args=args))
        assert not result.ok
        assert expected in result.content
        assert len(github.provider.get()._prs) == 1  # only the fixture PR


class TestGHCR:
    async def test_newest_green_tag_skips_a_failing_newer_tag(self) -> None:
        """The newest published tag fails CI; the answer must be the one below it."""
        out = await ghcr.tools.newest_green_tag(image="tickup-web")
        assert "c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a" in out
        assert "skipped 1 newer" in out

    async def test_missing_package_is_an_error_result_not_a_crash(self, registry) -> None:
        from quaerium.agents import ToolCall

        result = await registry.invoke(ToolCall(id="x", name="ghcr__list_tags", args={"image": "nope"}))
        assert not result.ok
        assert "not found" in result.content


class TestPrometheus:
    async def test_pod_resources_shows_memory_against_limit(self) -> None:
        out = await prometheus.tools.pod_resources(namespace="tickup")
        assert "tickup-backend-5f7c8d9b6-qw3rt" in out
        assert "498.0Mi" in out and "512.0Mi" in out and "97%" in out

    async def test_pod_prefix_narrows_the_result(self) -> None:
        out = await prometheus.tools.pod_resources(namespace="trip-ai", pod="trip-ai-web")
        assert "trip-ai-web" in out
        assert "trip-ai-backend" not in out

    async def test_a_name_cannot_break_out_of_the_matcher(self, registry) -> None:
        from quaerium.agents import ToolCall

        result = await registry.invoke(
            ToolCall(id="x", name="prometheus__pod_resources", args={"namespace": 'tickup"} or vector(1) #'})
        )
        assert not result.ok
        assert "not a valid Kubernetes name" in result.content

    async def test_range_is_summarised_and_shows_the_leak(self) -> None:
        out = await prometheus.tools.query_range(
            promql='container_memory_working_set_bytes{namespace="tickup"}', minutes=120
        )
        assert "MIN" in out and "CHANGE" in out
        assert "+" in out  # the leaking backend climbs across the window
        assert len(out.splitlines()) == 4  # header line, table header, rule, one series

    async def test_unknown_metric_says_so(self) -> None:
        assert "No series matched" in await prometheus.tools.query(promql="nonexistent_metric")


class TestLoki:
    async def test_search_finds_lines_from_before_the_restart(self) -> None:
        out = await loki.tools.search(namespace="tickup", contains="memory high")
        assert out.count("rss=") == 2
        assert "trip-ai" not in out

    async def test_search_window_excludes_older_lines(self) -> None:
        out = await loki.tools.search(namespace="tickup", contains="memory high", minutes=10)
        assert out.count("rss=") == 1

    async def test_lines_come_back_oldest_first(self) -> None:
        out = await loki.tools.search(namespace="tickup", contains="cache.leaderboard")
        sizes = [line.split("size=")[1].split()[0] for line in out.splitlines() if "size=" in line]
        assert sizes == ["41210", "88754", "90311"]

    async def test_limit_keeps_the_newest(self) -> None:
        out = await loki.tools.search(namespace="tickup", limit=1)
        assert "rss=498Mi" in out

    async def test_quotes_in_the_needle_are_escaped(self) -> None:
        out = await loki.tools.search(namespace="trip-ai", contains='"POST /api/trips')
        assert "201 Created" in out

    async def test_raw_query(self) -> None:
        out = await loki.tools.query(logql='{app="trip-ai"} |= "health"')
        assert "1 line(s)" in out


class TestAlertmanager:
    async def test_heartbeat_and_silenced_are_left_out(self) -> None:
        out = await alertmanager.tools.list_alerts()
        assert "3 alert(s)" in out
        assert "Watchdog" not in out and "CPUThrottlingHigh" not in out

    async def test_silenced_on_request(self) -> None:
        out = await alertmanager.tools.list_alerts(include_silenced=True)
        assert "CPUThrottlingHigh" in out and "(suppressed)" in out

    async def test_namespace_filter(self) -> None:
        assert "No alerts firing in trip-ai." == await alertmanager.tools.list_alerts(namespace="trip-ai")

    async def test_target_skips_the_exporter_pod(self) -> None:
        """kube-state-metrics alerts name the exporter's pod; the subject is the Deployment."""
        alerts = {a.name: a for a in await alertmanager.provider.get().alerts()}
        assert alerts["KubeDeploymentReplicasMismatch"].target == "Deployment/tickup-backend"
        assert alerts["KubeDeploymentReplicasMismatch"].container == ""
        assert alerts["KubePodCrashLooping"].target == "Pod/tickup-backend-5f7c8d9b6-qw3rt"
        assert alerts["KubePodCrashLooping"].container == "backend"
        assert alerts["KubePodCrashLooping"].description.endswith('(reason: "CrashLoopBackOff").')

    async def test_oldest_first_within_a_severity(self) -> None:
        names = [a.name for a in await alertmanager.provider.get().alerts()]
        assert names[-1] == "KubePodNotReady"  # 1.2h, younger than the two 13h alerts


class TestPlaybooks:
    async def test_brief_names_the_subject_and_drops_the_exporter_pod(self) -> None:
        from jarvis.agent.playbooks import investigate_alert

        alerts = {a.name: a for a in await alertmanager.provider.get().alerts()}
        prompt = investigate_alert(alerts["KubeDeploymentReplicasMismatch"])
        assert "About: tickup/Deployment/tickup-backend" in prompt
        assert "kube-state-metrics" not in prompt
        assert "Firing for: 13.0 hours" in prompt
        assert "pull request" in prompt

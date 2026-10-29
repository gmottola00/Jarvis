"""The capabilities, against their fixtures."""

from __future__ import annotations

from jarvis.tools import argocd, ghcr, github, k8s, loki, prometheus


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


class TestGHCR:
    async def test_newest_green_tag_skips_a_failing_newer_tag(self) -> None:
        """The newest published tag fails CI; the answer must be the one below it."""
        out = await ghcr.tools.newest_green_tag(image="tickup-web")
        assert "c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a" in out
        assert "skipped 1 newer" in out

    async def test_missing_package_is_an_error_result_not_a_crash(self, registry) -> None:
        from jarvis.core.types import ToolCall

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
        from jarvis.core.types import ToolCall

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

from jarvis.tools.argocd.client import ArgoCDClient


def _app(destination: str = "", resources: list[dict[str, str]] | None = None) -> dict:
    return {
        "metadata": {"name": "notify"},
        "spec": {"destination": {"namespace": destination} if destination else {}, "source": {}},
        "status": {"resources": resources or []},
    }


class TestNamespace:
    def test_destination_wins(self) -> None:
        assert ArgoCDClient._to_status(_app("cnpg-system", [{"namespace": "other"}])).namespace == "cnpg-system"

    def test_falls_back_to_where_most_resources_are(self) -> None:
        resources = [
            {"kind": "Namespace"},
            {"namespace": "notify"},
            {"namespace": "notify"},
            {"namespace": "kube-system"},
        ]
        assert ArgoCDClient._to_status(_app(resources=resources)).namespace == "notify"

    def test_empty_when_nothing_says(self) -> None:
        assert ArgoCDClient._to_status(_app()).namespace == ""

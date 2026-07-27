from app.runtime.model_test import run_model_test
from app.runtime.service import RuntimeService


def test_run_model_test_fails_when_runtime_stopped() -> None:
    service = RuntimeService()
    report = run_model_test(service)

    assert report.overall == "fail"
    assert report.steps[0].id == "runtime-status"
    assert report.steps[0].status == "fail"

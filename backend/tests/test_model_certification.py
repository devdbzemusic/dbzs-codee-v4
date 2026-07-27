import pytest

from app.context.certification import CertificationCase, certify_model
from app.context.certification import CertificationStore, ModelCertificationRunner
from app.runtime.schemas import RuntimeChatMessage, RuntimeChatResponse


def test_certification_requires_complete_measured_success() -> None:
    categories = ["code_understanding", "multi_file", "patch_format", "review", "debugging",
                  "tool_calling", "long_instruction", "context_retention", "structured_output"]
    report = certify_model("coder", "gpu:test", [
        CertificationCase(name=name, category=name, passed=True, duration_ms=10) for name in categories
    ])
    assert report.certified is True
    assert report.score == 100
    failed = certify_model("coder", "gpu:test", [
        CertificationCase(name="tool", category="tool_calling", passed=False, duration_ms=5)
    ])
    assert failed.certified is False
    assert failed.failed_categories == ["tool_calling"]


def test_certification_rejects_unmeasured_profiles() -> None:
    with pytest.raises(ValueError, match="measured"):
        certify_model("unknown", "unknown", [])


def test_runner_executes_and_persists_all_measured_cases(tmp_path) -> None:
    def chat(request):
        category = request.messages[-1].content.split("case: ", 1)[1].split(".", 1)[0]
        return RuntimeChatResponse(message=RuntimeChatMessage(
            role="assistant", content=f'{{"category":"{category}","passed":true}}'),
            model_id="coder", model_name="Coder v1")

    store = CertificationStore(tmp_path)
    report = ModelCertificationRunner(chat, store).run(
        model_id="coder", slot_id="fast_gpu", hardware="gpu:test", model_version="v1")
    assert report.certified is True
    assert len(report.cases) == 9
    assert all(case.duration_ms > 0 for case in report.cases)
    assert store.get(report.run_id) == report
    assert store.latest("coder") == report


def test_runner_accepts_json_object_inside_fenced_runtime_reply(tmp_path) -> None:
    def chat(request):
        category = request.messages[-1].content.split("case: ", 1)[1].split(".", 1)[0]
        return RuntimeChatResponse(message=RuntimeChatMessage(
            role="assistant",
            content=f'Gemessen:\n```json\n{{"category":"{category}","passed":true}}\n```'),
            model_id="coder", model_name="Coder v1")

    report = ModelCertificationRunner(chat, CertificationStore(tmp_path)).run(
        model_id="coder", slot_id="fast_gpu", hardware="gpu:test")
    assert report.certified is True
    assert report.score == 100


def test_runner_never_certifies_simulation(tmp_path) -> None:
    def chat(request):
        category = request.messages[-1].content.split("case: ", 1)[1].split(".", 1)[0]
        return RuntimeChatResponse(message=RuntimeChatMessage(
            role="assistant", content=f'{{"category":"{category}","passed":true}}'),
            model_id="simulation", model_name="SIM")
    report = ModelCertificationRunner(chat, CertificationStore(tmp_path)).run(
        model_id="coder", slot_id="fast_gpu", hardware="none")
    assert report.certified is False
    assert report.score == 0

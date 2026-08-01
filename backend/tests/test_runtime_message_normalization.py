from app.runtime.schemas import RuntimeChatMessage, RuntimeChatRequest
from app.runtime.service import RuntimeService


def _service_without_init() -> RuntimeService:
    return RuntimeService.__new__(RuntimeService)


def test_runtime_build_chat_messages_moves_late_system_context_to_front() -> None:
    service = _service_without_init()

    messages = service._build_chat_messages(
        RuntimeChatRequest(
            messages=[
                RuntimeChatMessage(role="user", content="Zaehle alle gguf Modelle."),
                RuntimeChatMessage(role="system", content="Workspace: D:/Models"),
                RuntimeChatMessage(role="system", content="Kontext: 6 Dateien geladen"),
                RuntimeChatMessage(role="user", content="Bitte jetzt ausfuehren."),
            ],
        )
    )

    assert [message.role for message in messages] == ["system", "user"]
    assert "Workspace: D:/Models" in messages[0].content
    assert "Kontext: 6 Dateien geladen" in messages[0].content
    assert "Zaehle alle gguf Modelle." in messages[1].content
    assert "Bitte jetzt ausfuehren." in messages[1].content


def test_runtime_build_chat_messages_keeps_dialog_alternating_after_context_lift() -> None:
    service = _service_without_init()

    messages = service._build_chat_messages(
        RuntimeChatRequest(
            messages=[
                RuntimeChatMessage(role="user", content="Erster Turn"),
                RuntimeChatMessage(role="assistant", content="Antwort"),
                RuntimeChatMessage(role="system", content="Spaeter Kontext"),
                RuntimeChatMessage(role="user", content="Naechster Turn"),
            ],
        )
    )

    assert [message.role for message in messages] == ["system", "user", "assistant", "user"]
    assert "Spaeter Kontext" in messages[0].content

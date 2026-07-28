import base64
from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def test_prepare_chat_attachments_inlines_text_file() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
          "attachments": [
              {
                  "name": "notes.md",
                  "source": "clipboard",
                  "extension": "md",
                  "mime_type": "text/markdown",
                  "data_base64": _b64(b"# Hello")
              }
          ]
        },
    )

    assert response.status_code == 200
    payload = response.json()["attachments"][0]
    assert payload["kind"] == "text"
    assert payload["text_content"] == "# Hello"


def test_prepare_chat_attachments_extracts_zip_inventory_and_text() -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("src/example.ts", "export const value = 1;\n")
        archive.writestr("bin/blob.bin", b"\x00\x01\x02")

    client = TestClient(app)
    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
            "attachments": [
                {
                    "name": "bundle.zip",
                    "source": "clipboard",
                    "extension": "zip",
                    "mime_type": "application/zip",
                    "data_base64": _b64(buffer.getvalue()),
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()["attachments"][0]
    assert payload["kind"] == "archive"
    assert "src/example.ts" in (payload["text_content"] or "")
    assert any(entry["path"] == "src/example.ts" and entry["included_inline"] for entry in payload["archive_entries"])
    assert any(entry["path"] == "bin/blob.bin" and entry["kind"] == "binary" for entry in payload["archive_entries"])


def test_prepare_chat_attachments_returns_pdf_fallback_for_blank_document() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=120, height=120)
    buffer = BytesIO()
    writer.write(buffer)

    client = TestClient(app)
    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
            "attachments": [
                {
                    "name": "blank.pdf",
                    "source": "clipboard",
                    "extension": "pdf",
                    "mime_type": "application/pdf",
                    "data_base64": _b64(buffer.getvalue()),
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()["attachments"][0]
    assert payload["kind"] == "document"
    assert payload["text_content"] == "[PDF ohne extrahierbaren Text]"


def test_prepare_chat_attachments_rejects_unsupported_extension() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
            "attachments": [
                {
                    "name": "payload.exe",
                    "source": "clipboard",
                    "extension": "exe",
                    "mime_type": "application/octet-stream",
                    "data_base64": _b64(b"noop"),
                }
            ]
        },
    )

    assert response.status_code == 400


def test_prepare_chat_attachments_returns_error_attachment_for_broken_pdf() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
            "attachments": [
                {
                    "name": "broken.pdf",
                    "source": "clipboard",
                    "extension": "pdf",
                    "mime_type": "application/pdf",
                    "data_base64": _b64(b"not-a-real-pdf"),
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()["attachments"][0]
    assert payload["kind"] == "document"
    assert payload["error"]
    assert payload["derived_summary"] == "Datei konnte nicht aufbereitet werden"


def test_prepare_chat_attachments_keeps_successful_files_when_zip_is_broken() -> None:
    client = TestClient(app)

    response = client.post(
        "/runtime/prepare-chat-attachments",
        json={
            "attachments": [
                {
                    "name": "notes.md",
                    "source": "clipboard",
                    "extension": "md",
                    "mime_type": "text/markdown",
                    "data_base64": _b64(b"# Hello"),
                },
                {
                    "name": "broken.zip",
                    "source": "clipboard",
                    "extension": "zip",
                    "mime_type": "application/zip",
                    "data_base64": _b64(b"not-a-real-zip"),
                },
            ]
        },
    )

    assert response.status_code == 200
    attachments = response.json()["attachments"]
    assert attachments[0]["kind"] == "text"
    assert attachments[0]["text_content"] == "# Hello"
    assert attachments[1]["kind"] == "archive"
    assert attachments[1]["error"]
    assert attachments[1]["derived_summary"] == "Datei konnte nicht aufbereitet werden"

import base64
import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from pypdf import PdfReader

from app.runtime.schemas import (
    ChatAttachmentArchiveEntry,
    ChatAttachmentPrepared,
    ChatAttachmentPrepareSource,
)

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
ALLOWED_TEXT_EXTENSIONS = {".md", ".json", ".js", ".ts", ".tsx", ".py", ".txt"}
ALLOWED_DOCUMENT_EXTENSIONS = {".pdf"}
ALLOWED_ARCHIVE_EXTENSIONS = {".zip"}
ALLOWED_EXTENSIONS = (
    ALLOWED_IMAGE_EXTENSIONS
    | ALLOWED_TEXT_EXTENSIONS
    | ALLOWED_DOCUMENT_EXTENSIONS
    | ALLOWED_ARCHIVE_EXTENSIONS
)

MAX_TEXT_CHARS_PER_FILE = 12_000
MAX_TEXT_CHARS_TOTAL = 40_000
MAX_ARCHIVE_ENTRIES = 200


def _error_attachment(
    source: ChatAttachmentPrepareSource,
    extension: str,
    message: str,
) -> ChatAttachmentPrepared:
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        kind = "image"
    else:
        kind = _kind_for_extension(extension)
    return ChatAttachmentPrepared(
        id=f"att-{uuid.uuid4().hex}",
        name=source.name,
        kind=kind,  # type: ignore[arg-type]
        extension=extension.lstrip("."),
        mime_type=source.mime_type or _mime_type_for_extension(extension),
        source=source.source,
        size_bytes=source.size_bytes,
        path=source.path,
        derived_summary="Datei konnte nicht aufbereitet werden",
        error=message,
    )


def _normalize_extension(source: ChatAttachmentPrepareSource) -> str:
    candidate = source.extension or Path(source.name).suffix
    if not candidate:
        return ""
    normalized = candidate.lower()
    return normalized if normalized.startswith(".") else f".{normalized}"


def _read_source_bytes(source: ChatAttachmentPrepareSource) -> bytes:
    if source.path:
        return Path(source.path).read_bytes()
    if source.data_base64:
        return base64.b64decode(source.data_base64)
    raise ValueError(f"Attachment payload fehlt: {source.name}")


def _kind_for_extension(extension: str) -> str:
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        return "image"
    if extension in ALLOWED_TEXT_EXTENSIONS:
        if extension in {".js", ".ts", ".tsx", ".py"}:
            return "code"
        return "text"
    if extension in ALLOWED_DOCUMENT_EXTENSIONS:
        return "document"
    if extension in ALLOWED_ARCHIVE_EXTENSIONS:
        return "archive"
    raise ValueError(f"Dateityp nicht erlaubt: {extension or '<none>'}")


def _mime_type_for_extension(extension: str) -> str:
    mapping = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".md": "text/markdown",
        ".json": "application/json",
        ".js": "text/javascript",
        ".ts": "text/typescript",
        ".tsx": "text/tsx",
        ".py": "text/x-python",
        ".txt": "text/plain",
        ".pdf": "application/pdf",
        ".zip": "application/zip",
    }
    return mapping.get(extension, "application/octet-stream")


def _decode_text_bytes(data: bytes, file_name: str) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"Datei ist nicht als UTF-8 lesbar: {file_name}") from None


def _clip_text(text: str, remaining: int) -> tuple[str, bool]:
    allowed = max(0, min(MAX_TEXT_CHARS_PER_FILE, remaining))
    if len(text) <= allowed:
        return text, False
    return text[:allowed], True


def _prepare_image_attachment(
    source: ChatAttachmentPrepareSource,
    extension: str,
    data: bytes,
) -> ChatAttachmentPrepared:
    mime_type = source.mime_type or _mime_type_for_extension(extension)
    data_url = f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
    return ChatAttachmentPrepared(
        id=f"att-{uuid.uuid4().hex}",
        name=source.name,
        kind="image",
        extension=extension.lstrip("."),
        mime_type=mime_type,
        source=source.source,
        size_bytes=source.size_bytes or len(data),
        path=source.path,
        data_url=data_url,
    )


def _prepare_text_attachment(
    source: ChatAttachmentPrepareSource,
    extension: str,
    data: bytes,
    remaining_chars: int,
) -> tuple[ChatAttachmentPrepared, int]:
    text = _decode_text_bytes(data, source.name)
    clipped, truncated = _clip_text(text, remaining_chars)
    consumed = len(clipped)
    kind = _kind_for_extension(extension)
    return (
        ChatAttachmentPrepared(
            id=f"att-{uuid.uuid4().hex}",
            name=source.name,
            kind=kind,  # type: ignore[arg-type]
            extension=extension.lstrip("."),
            mime_type=source.mime_type or _mime_type_for_extension(extension),
            source=source.source,
            size_bytes=source.size_bytes or len(data),
            path=source.path,
            text_content=clipped,
            derived_summary=f"{consumed} Zeichen eingebunden" + (" (gekuerzt)" if truncated else ""),
            truncated=truncated,
        ),
        consumed,
    )


def _prepare_pdf_attachment(
    source: ChatAttachmentPrepareSource,
    data: bytes,
    remaining_chars: int,
) -> tuple[ChatAttachmentPrepared, int]:
    reader = PdfReader(BytesIO(data))
    extracted_pages: list[str] = []
    for page in reader.pages:
        extracted_pages.append(page.extract_text() or "")
    text = "\n\n".join(part for part in extracted_pages if part.strip())
    if not text.strip():
        text = "[PDF ohne extrahierbaren Text]"
    clipped, truncated = _clip_text(text, remaining_chars)
    consumed = len(clipped)
    return (
        ChatAttachmentPrepared(
            id=f"att-{uuid.uuid4().hex}",
            name=source.name,
            kind="document",
            extension="pdf",
            mime_type=source.mime_type or "application/pdf",
            source=source.source,
            size_bytes=source.size_bytes or len(data),
            path=source.path,
            text_content=clipped,
            derived_summary=f"PDF mit {len(reader.pages)} Seite(n), {consumed} Zeichen extrahiert" + (" (gekuerzt)" if truncated else ""),
            truncated=truncated,
        ),
        consumed,
    )


def _prepare_zip_attachment(
    source: ChatAttachmentPrepareSource,
    data: bytes,
    remaining_chars: int,
) -> tuple[ChatAttachmentPrepared, int]:
    archive_entries: list[ChatAttachmentArchiveEntry] = []
    text_sections: list[str] = []
    consumed = 0
    truncated = False

    with tempfile.TemporaryDirectory(prefix="dbzs-chat-zip-") as temp_dir:
        archive_path = Path(temp_dir) / source.name
        archive_path.write_bytes(data)
        extract_root = Path(temp_dir) / "extract"
        extract_root.mkdir(parents=True, exist_ok=True)
        with ZipFile(archive_path) as archive:
            archive.extractall(extract_root)

        extracted_files = sorted(path for path in extract_root.rglob("*") if path.is_file())
        for index, file_path in enumerate(extracted_files):
            if index >= MAX_ARCHIVE_ENTRIES:
                truncated = True
                break
            relative_path = file_path.relative_to(extract_root).as_posix()
            extension = file_path.suffix.lower()
            entry_kind = (
                _kind_for_extension(extension)
                if extension in ALLOWED_EXTENSIONS and extension not in ALLOWED_ARCHIVE_EXTENSIONS
                else "binary"
            )
            included_inline = False
            entry_truncated = False

            if extension in ALLOWED_TEXT_EXTENSIONS and consumed < remaining_chars:
                try:
                    raw_text = _decode_text_bytes(file_path.read_bytes(), relative_path)
                    clipped, entry_truncated = _clip_text(raw_text, remaining_chars - consumed)
                    if clipped.strip():
                        text_sections.append(f"## {relative_path}\n```{extension.lstrip('.') or 'text'}\n{clipped}\n```")
                        consumed += len(clipped)
                        included_inline = True
                        truncated = truncated or entry_truncated
                except ValueError:
                    entry_kind = "binary"

            archive_entries.append(
                ChatAttachmentArchiveEntry(
                    path=relative_path,
                    kind=entry_kind,  # type: ignore[arg-type]
                    size_bytes=file_path.stat().st_size,
                    included_inline=included_inline,
                    truncated=entry_truncated,
                )
            )

    return (
        ChatAttachmentPrepared(
            id=f"att-{uuid.uuid4().hex}",
            name=source.name,
            kind="archive",
            extension="zip",
            mime_type=source.mime_type or "application/zip",
            source=source.source,
            size_bytes=source.size_bytes or len(data),
            path=source.path,
            text_content="\n\n".join(text_sections) if text_sections else None,
            derived_summary=f"ZIP mit {len(archive_entries)} Eintraegen" + (" (gekuerzt)" if truncated else ""),
            archive_entries=archive_entries,
            truncated=truncated,
        ),
        consumed,
    )


def prepare_chat_attachments(
    sources: list[ChatAttachmentPrepareSource],
) -> list[ChatAttachmentPrepared]:
    prepared: list[ChatAttachmentPrepared] = []
    remaining_chars = MAX_TEXT_CHARS_TOTAL

    for source in sources:
        extension = _normalize_extension(source)
        if extension not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Dateityp nicht erlaubt: {source.name}")
        try:
            data = _read_source_bytes(source)
            if extension in ALLOWED_IMAGE_EXTENSIONS:
                prepared.append(_prepare_image_attachment(source, extension, data))
                continue
            if extension in ALLOWED_TEXT_EXTENSIONS:
                attachment, consumed = _prepare_text_attachment(source, extension, data, remaining_chars)
                prepared.append(attachment)
                remaining_chars = max(0, remaining_chars - consumed)
                continue
            if extension in ALLOWED_DOCUMENT_EXTENSIONS:
                attachment, consumed = _prepare_pdf_attachment(source, data, remaining_chars)
                prepared.append(attachment)
                remaining_chars = max(0, remaining_chars - consumed)
                continue
            if extension in ALLOWED_ARCHIVE_EXTENSIONS:
                attachment, consumed = _prepare_zip_attachment(source, data, remaining_chars)
                prepared.append(attachment)
                remaining_chars = max(0, remaining_chars - consumed)
                continue
        except ValueError as exc:
            prepared.append(_error_attachment(source, extension, str(exc)))
            continue
        except Exception as exc:
            prepared.append(_error_attachment(source, extension, f"Datei konnte nicht aufbereitet werden: {exc}"))
            continue

    return prepared

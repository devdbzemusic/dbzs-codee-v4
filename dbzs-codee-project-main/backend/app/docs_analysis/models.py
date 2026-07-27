from pydantic import BaseModel, ConfigDict, Field


class ExtensionStat(BaseModel):
    extension: str
    count: int


class FileSizeStat(BaseModel):
    path: str
    size_bytes: int


class DocsAnalysisSummary(BaseModel):
    scanned_at: str
    workspace_root: str
    files_scanned: int
    directories_scanned: int
    todo_count: int
    top_extensions: list[ExtensionStat]
    largest_files: list[FileSizeStat]


class DocsGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: str = Field(min_length=1, max_length=260)
    max_files: int = Field(default=5, ge=1, le=20)


class DocsGenerateResponse(BaseModel):
    content: str
    summary: DocsAnalysisSummary

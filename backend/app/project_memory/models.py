from pydantic import BaseModel, ConfigDict, Field


class ProjectMemoryEntry(BaseModel):
    id: int
    workspace: str
    memory_key: str
    content: str
    tags: list[str]
    created_at: str
    updated_at: str


class ProjectMemoryUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace: str = Field(min_length=1, max_length=260)
    memory_key: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=20_000)
    tags: list[str] = Field(default_factory=list)

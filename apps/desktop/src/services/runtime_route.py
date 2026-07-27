from typing import List, Literal
from pydantic import BaseModel, Field


class ResolvedRuntimeRoute(BaseModel):
    """
    Definiert die finale, verbindliche Routing-Entscheidung für einen Run.
    Dies ist der Pydantic-Teil des gemeinsamen Protokollvertrags (P1-Task).
    """
    model_id: str = Field(..., description="Die ID des ausgewählten Modells.")
    model_name: str = Field(..., description="Der Anzeigename des ausgewählten Modells.")
    slot_id: str = Field(..., description="Die ID des Slots, in dem das Modell läuft.")
    profile: str = Field(..., description="Das verwendete Runtime-Profil (z.B. 'default').")
    provider: str = Field(..., description="Der Provider, der das Modell bereitstellt (z.B. 'llama.cpp').")
    reasons: List[str] = Field(..., description="Gründe für die Routing-Entscheidung.")
    source: Literal["role_setting", "automatic", "fallback", "resident_continue", "explicit_fallback"] = Field(
        ..., description="Die Quelle der Modellauswahl."
    )

    class Config:
        allow_population_by_field_name = True
        orm_mode = True

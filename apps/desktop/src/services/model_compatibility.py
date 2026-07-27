from typing import Literal, Optional
from pydantic import BaseModel, Field


class ModelRuntimeCompatibility(BaseModel):
    """
    Definiert das Laufzeit-Kompatibilitätsprofil eines Modells.
    Stellt sicher, dass der Runner weiß, wie er mit einem Modell interagieren muss.
    PRIORITÄT 4
    """

    api_mode: Literal["chat", "completion"] = Field(
        ..., description="API-Modus für die Inferenz (Chat- oder Completion-Endpunkt)."
    )
    chat_template: Optional[str] = Field(
        None, description="Jinja2-Template für die Chat-Formatierung, falls vom Modell benötigt."
    )
    supports_streaming: bool = Field(..., description="Ob das Modell Streaming-Antworten unterstützt.")
    supports_tools: bool = Field(..., description="Ob das Modell strukturierte Tool-Calls unterstützt.")
    reasoning_mode: Literal["none", "separate_field", "inline"] = Field(
        ..., description="Wie das Modell Reasoning-Output liefert."
    )
    warmup_prompt: str = Field(..., description="Ein minimaler, gültiger Prompt für den Warm-up.")
    warmup_expected_channel: str = Field(
        ..., description="In welchem Kanal der Antwort die erste verwertbare Ausgabe erwartet wird."
    )

    class Config:
        allow_population_by_field_name = True
        orm_mode = True

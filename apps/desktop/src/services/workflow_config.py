from typing import List, Literal, Dict, Any, Optional, Union
from pydantic import BaseModel, Field


class WorkflowNodeBase(BaseModel):
    id: str = Field(..., description="Eindeutige ID des Knotens innerhalb des Workflows.")
    description: Optional[str] = Field(None, description="Optionale Beschreibung des Knotens.")


class ClassifyIntentNode(WorkflowNodeBase):
    type: Literal["classify_intent"] = "classify_intent"
    # Keine weitere Konfiguration nötig, verwendet den globalen Intent Classifier.


class ToolNode(WorkflowNodeBase):
    type: Literal["run_tool"] = "run_tool"
    tool_id: str = Field(..., description="Die ID des auszuführenden Tools (z.B. 'workspace-file-tool').")
    # Eingaben können statisch oder aus dem Output eines vorherigen Knotens bezogen werden.
    inputs: Dict[str, Any] = Field({}, description="Parameter für den Tool-Aufruf.")


class LLMNode(WorkflowNodeBase):
    type: Literal["llm_call"] = "llm_call"
    model_role: str = Field(..., description="Die Rolle des Modells (z.B. 'planner', 'coder').")
    system_prompt: Optional[str] = Field(None, description="Ein spezifischer System-Prompt für diesen Aufruf.")
    temperature: float = Field(0.2, ge=0.0, le=2.0, description="Die Temperatur für die Generierung.")


class BranchNode(WorkflowNodeBase):
    type: Literal["branch"] = "branch"
    # Die Bedingung würde auf den Output eines vorherigen Knotens verweisen.
    # Beispiel: "nodes.classify_intent.output.intent == 'workspace_query'"
    condition: str = Field(..., description="Eine Ausdrucks-Bedingung, die den Pfad bestimmt.")


class WorkflowEdge(BaseModel):
    from_node: str = Field(..., description="ID des Quell-Knotens.")
    to_node: str = Field(..., description="ID des Ziel-Knotens.")
    # Definiert, welcher Ausgang eines Branch-Knotens genommen wird.
    condition_case: Optional[Literal["true", "false"]] = Field(None, description="Für Branch-Knoten: 'true' oder 'false'.")


AnyWorkflowNode = Union[ClassifyIntentNode, ToolNode, LLMNode, BranchNode]


class WorkflowTrigger(BaseModel):
    type: Literal["on_intent", "default"] = Field(..., description="Art des Triggers.")
    # Wenn type == 'on_intent', ist dies der spezifische Intent.
    intent: Optional[str] = Field(None, description="Der Intent, der diesen Workflow auslöst.")


class WorkflowDefinition(BaseModel):
    """
    Definiert einen einzelnen, konfigurierbaren Workflow, der von einem
    grafischen Editor erzeugt werden könnte.
    """
    id: str = Field(..., description="Eindeutige ID des Workflows.")
    name: str = Field(..., description="Ein menschenlesbarer Name für den Workflow.")
    trigger: WorkflowTrigger = Field(..., description="Die Bedingung, die diesen Workflow startet.")
    nodes: List[AnyWorkflowNode] = Field(..., description="Die Knoten (Schritte) des Workflows.")
    edges: List[WorkflowEdge] = Field(..., description="Die Verbindungen zwischen den Knoten.")
    start_node_id: str = Field(..., description="Die ID des Start-Knotens.")


class WorkflowConfiguration(BaseModel):
    """
    Wurzelobjekt für eine Sammlung von benutzerdefinierten Workflows.
    """
    schema_version: int = 1
    workflows: List[WorkflowDefinition] = []

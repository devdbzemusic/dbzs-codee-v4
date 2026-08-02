import uuid

from app.model_lab.repository import ModelLabRepository
from app.models.index_service import ModelIndexService
from app.models.model_lab_bridge import resolve_bundle_to_model_id
from app.models.schemas import IndexedModel, MultimodalPair
from app.runtime.errors import RuntimeProviderError
from app.runtime.residency import RuntimeResidencyRegistry
from app.runtime.schemas import RuntimeRouteRequest, RuntimeRouteResponse
from app.settings.service import SettingsService

# Official Workflow-Role -> Fleet-Role mapping (Massnahmenkatalog M-002).
# Only the "preferred" fleet role per workflow agent — special-role fallback
# (e.g. ALGORITHM_SPECIALIST, DEEP_RESEARCH_AGENT) is left to a later slice.
_WORKFLOW_AGENT_TO_FLEET_ROLE: dict[str, str] = {
    "default": "FAST_GENERAL_AGENT",
    "coder": "CODING_EXECUTOR",
    "reviewer": "REASONING_VALIDATOR",
    "tester": "REASONING_VALIDATOR",
    "planner": "MAIN_AGENT",
}

_CODING_TASK_TYPES = {
    "small_code_change",
    "large_code_change",
    "debugging",
    "refactoring",
    "review",
    "test_analysis",
}


def _is_vision_model(model: IndexedModel) -> bool:
    return "vision" in model.modality or model.recommended_use == "vision_candidate"


def _requires_vision_projector(model: IndexedModel) -> bool:
    """Whether `model` needs a separately-loaded MMProj projector rather than
    being natively multimodal. Approximated from recommended_use, mirroring
    the desktop broker's modelRequiresVisionProjector() fallback heuristic —
    the index doesn't carry an explicit per-model flag for this yet."""
    return model.recommended_use == "vision_candidate"


def _supports_text_only(model: IndexedModel) -> bool:
    return not _is_vision_model(model) or "text" in model.modality


def _find_verified_pair(model_id: str, pairs: list[MultimodalPair]) -> MultimodalPair | None:
    for pair in pairs:
        if pair.base_model_id == model_id and pair.routing_allowed:
            return pair
    return None


def _is_fallback_candidate_eligible(
    model: IndexedModel, allow_vision: bool, pairs: list[MultimodalPair]
) -> bool:
    if model.artifact_type != "model":
        return False
    if not _is_vision_model(model):
        return True
    if not allow_vision:
        return False
    if _supports_text_only(model):
        return True
    return _find_verified_pair(model.id, pairs) is not None


def _score_fallback_candidate(model: IndexedModel, task_type: str) -> int:
    requires_coding = task_type in _CODING_TASK_TYPES
    score = 0
    if requires_coding and "code" in model.capabilities:
        score += 100
    if requires_coding and model.recommended_use == "primary_coding":
        score += 50
    if requires_coding and model.recommended_use == "coding_candidate":
        score += 25
    if not requires_coding and "chat" in model.capabilities:
        score += 30
    if not requires_coding and model.recommended_use == "chat_candidate":
        score += 20
    return score


class FleetRoutingResolver:
    """Single backend authority for runtime routing decisions (Workflow-Bruch
    WF-01/WF-09/WF-10). Desktop must not perform a second, independent model
    selection — modelSelectionBroker.brokerDecision() and
    runtimeSlotManager.resolveDefaultModelForSlot() both delegate here.

    Also owns the vision-gate, capability-gate and tiered role-model fallback
    that used to live only in the desktop's resolveModelIdWithVisionGate() —
    ported 1:1 in behavior, not redesigned, so existing UX (error codes,
    fallback tiers) stays intact once the desktop side is fully migrated.
    """

    def __init__(
        self,
        settings_service: SettingsService,
        index_service: ModelIndexService,
        residency: RuntimeResidencyRegistry | None = None,
        model_lab_repo: ModelLabRepository | None = None,
    ):
        self.settings = settings_service
        self.index = index_service
        self.residency = residency
        self.model_lab_repo = model_lab_repo

    def _model_lab_candidate(self, target_agent: str, index_data, catalog_by_id: dict[str, IndexedModel]) -> str | None:
        """Best certified, routing-allowed Model Lab bundle for `target_agent`'s
        preferred fleet role, resolved to a runtime model id — or None if no
        Model Lab role assignment exists yet (most personal installs won't have
        run certification, so this must degrade gracefully to the flat
        settings-based fallback, never hard-fail)."""
        if self.model_lab_repo is None:
            return None
        fleet_role = _WORKFLOW_AGENT_TO_FLEET_ROLE.get(target_agent)
        if fleet_role is None:
            return None
        entries = [e for e in self.model_lab_repo.list_routing_map(role=fleet_role) if e.routing_allowed]
        entries.sort(key=lambda e: e.priority)
        for entry in entries:
            model_id = resolve_bundle_to_model_id(
                entry.bundle_id, model_lab_repo=self.model_lab_repo, model_index=index_data
            )
            if model_id and model_id in catalog_by_id:
                return model_id
        return None

    def resolve(self, request: RuntimeRouteRequest) -> RuntimeRouteResponse:
        settings = self.settings.load()
        reasons: list[str] = []

        # 1. Determine Target Agent & Configured Model
        target_agent = "default"
        configured_model_id = settings.defaultModelId
        slot_id = "quality_cpu"

        task = request.task_type
        if task in ["small_code_change", "large_code_change", "debugging", "refactoring"]:
            target_agent = "coder"
            if settings.defaultCoderModelId:
                configured_model_id = settings.defaultCoderModelId
            slot_id = "fast_gpu"
        elif task == "review":
            target_agent = "reviewer"
            if settings.defaultReviewerModelId:
                configured_model_id = settings.defaultReviewerModelId
            slot_id = "quality_cpu"
        elif task == "planning" or task == "architecture":
            target_agent = "planner"
            if settings.defaultPlannerModelId:
                configured_model_id = settings.defaultPlannerModelId
            slot_id = "quality_cpu"
        elif task in ["embedding", "reranking", "indexing"]:
            slot_id = "utility"
            if settings.defaultUtilityModelId:
                configured_model_id = settings.defaultUtilityModelId
        elif task == "test_analysis":
            target_agent = "tester"
            if settings.defaultCoderModelId:  # Fallback to coder for tester
                configured_model_id = settings.defaultCoderModelId
            slot_id = "fast_gpu"

        # 2. Vision override
        allow_vision = bool(request.has_image_input or request.requires_vision)
        if request.requires_vision:
            target_agent = "vision"
            slot_id = "vision_gpu"
            if settings.defaultVisionModelId:
                configured_model_id = settings.defaultVisionModelId

        reasons.append(f"task_type:{task}")
        reasons.append(f"target_agent:{target_agent}")
        reasons.append("vision_gate:vision_allowed" if allow_vision else "vision_gate:text_only")

        index_data = self.index.load_cached_index() or self.index.build_index()
        catalog_by_id = {model.id: model for model in index_data.models}

        # 3. Manual override — still vision-gated, never a silent swap.
        if request.manual_model_id and request.manual_model_id.strip():
            resolved_model_id = request.manual_model_id
            manual_entry = catalog_by_id.get(resolved_model_id)
            if allow_vision and manual_entry and _requires_vision_projector(manual_entry):
                verified_pair = _find_verified_pair(resolved_model_id, index_data.multimodal_pairs)
                if verified_pair is None:
                    raise RuntimeProviderError(
                        f"Visionmodell '{resolved_model_id}' benoetigt ein verifiziertes "
                        "MMProj-Pairing, aber es ist keine Routing-Freigabe vorhanden.",
                        code="vision_pairing_required",
                        recoverable=True,
                        diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                        recommended_action="MM-Pairing verifizieren oder anderes Modell waehlen.",
                    )
            reasons.append(f"manual_selection:{resolved_model_id}")
            selection_source = "manual_selection"
        elif configured_model_id:
            resolved_model_id = configured_model_id
            entry = catalog_by_id.get(resolved_model_id)
            if entry is None:
                raise RuntimeProviderError(
                    f"Konfiguriertes Rollenmodell '{resolved_model_id}' ist nicht im Modellindex.",
                    code="role_model_not_in_index",
                    recoverable=True,
                    diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                    recommended_action="Anderes Rollenmodell waehlen.",
                )
            if entry.artifact_type != "model":
                raise RuntimeProviderError(
                    f"Konfiguriertes Rollenmodell '{resolved_model_id}' ist ein "
                    f"Support-Artefakt ({entry.artifact_type}) und nicht direkt startbar.",
                    code="role_model_not_runnable",
                    recoverable=True,
                    diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                    recommended_action="Anderes Rollenmodell waehlen.",
                )
            if allow_vision and _requires_vision_projector(entry):
                verified_pair = _find_verified_pair(resolved_model_id, index_data.multimodal_pairs)
                if verified_pair is None:
                    raise RuntimeProviderError(
                        f"Visionmodell '{resolved_model_id}' benoetigt ein verifiziertes "
                        "MMProj-Pairing, aber es ist keine Routing-Freigabe vorhanden.",
                        code="vision_pairing_required",
                        recoverable=True,
                        diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                        recommended_action="MM-Pairing verifizieren oder anderes Rollenmodell waehlen.",
                    )
            elif not allow_vision and _is_vision_model(entry) and not _supports_text_only(entry):
                raise RuntimeProviderError(
                    f"Rollenmodell '{resolved_model_id}' ist ein Visionmodell ohne "
                    "Text-only-Support, und die Anfrage hat kein Bild.",
                    code="vision_gate_blocked",
                    recoverable=True,
                    diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                    recommended_action="Textmodell in Settings waehlen oder Bild anhaengen.",
                )
            reasons.append(f"role_setting:{resolved_model_id}")
            selection_source = "role_setting"
        else:
            # No role model configured — tiered fallback.
            reasons.append("role_fallback:role_model_missing")

            # Tier 1 (new): a certified, routing-allowed Model Lab role assignment
            # for this agent's fleet role (Massnahmenkatalog M-002/M-101, WF-09).
            # Only applied for non-vision turns — vision keeps its own dedicated
            # settings field and verified-pairing gate above.
            model_lab_model_id = None if allow_vision else self._model_lab_candidate(
                target_agent, index_data, catalog_by_id
            )

            if model_lab_model_id is not None:
                # Certified Model Lab role assignment wins over the generic
                # heuristic fallback tiers below (WF-10: certified assignment
                # before "just happens to be resident").
                resolved_model_id = model_lab_model_id
                reasons.append(f"role_fallback:model_lab_certified:{resolved_model_id}")
                selection_source = "explicit_fallback"
            else:
                resident_ids = {
                    entry.model_id
                    for entry in (self.residency.all_entries() if self.residency else [])
                }
                running_candidates = [
                    catalog_by_id[mid]
                    for mid in resident_ids
                    if mid in catalog_by_id
                    and _is_fallback_candidate_eligible(catalog_by_id[mid], allow_vision, index_data.multimodal_pairs)
                ]
                best_running = max(
                    running_candidates, key=lambda m: _score_fallback_candidate(m, task), default=None
                )
                if best_running is not None:
                    resolved_model_id = best_running.id
                    reasons.append(f"role_fallback:running_model:{resolved_model_id}")
                    selection_source = "explicit_fallback"
                else:
                    installed_candidates = [
                        model
                        for model in index_data.models
                        if _is_fallback_candidate_eligible(model, allow_vision, index_data.multimodal_pairs)
                    ]
                    best_installed = max(
                        installed_candidates, key=lambda m: _score_fallback_candidate(m, task), default=None
                    )
                    if best_installed is None:
                        raise RuntimeProviderError(
                            "Rollenmodell in Settings fehlt, und es ist weder ein laufendes noch ein "
                            "installiertes kompatibles Modell als Fallback verfuegbar.",
                            code="role_model_missing_no_fallback",
                            recoverable=True,
                            diagnostic_context={"source": "fleet-routing", "task_type": task},
                            recommended_action="Rollenmodell in Settings setzen oder ein Modell installieren.",
                        )
                    resolved_model_id = best_installed.id
                    reasons.append(f"role_fallback:installed_model:{resolved_model_id}")
                    selection_source = "explicit_fallback"

        resolved_entry = catalog_by_id.get(resolved_model_id)
        resolved_model_name = resolved_entry.name if resolved_entry else "Unknown Model"
        capabilities = resolved_entry.capabilities if resolved_entry else []
        reasons.append(f"selection_source:{selection_source}")

        # 4. Capability gate — a vision turn must never silently lose coding ability.
        if allow_vision and task in _CODING_TASK_TYPES and "code" not in capabilities:
            raise RuntimeProviderError(
                f"Modell '{resolved_model_name}' ist fuer diese Bild-Coding-/Review-Anfrage "
                "nicht freigegeben, weil die Code-Faehigkeit im Modellindex fehlt.",
                code="code_capability_missing",
                recoverable=True,
                diagnostic_context={"source": "fleet-routing", "model_id": resolved_model_id},
                recommended_action="Coding-faehiges Visionmodell waehlen oder Textmodell ohne Bild nutzen.",
            )

        projector_artifact_id = None
        if allow_vision and resolved_entry and _requires_vision_projector(resolved_entry):
            verified_pair = _find_verified_pair(resolved_model_id, index_data.multimodal_pairs)
            if verified_pair:
                projector_artifact_id = verified_pair.projector_artifact_id
                slot_id = "vision_gpu"

        return RuntimeRouteResponse(
            decision_id=str(uuid.uuid4()),
            task_type=task,
            target_agent=target_agent,
            slot_id=slot_id,
            model_id=resolved_model_id,
            model_name=resolved_model_name,
            configured_model_id=configured_model_id or "",
            resolved_model_id=resolved_model_id,
            resolved_model_name=resolved_model_name,
            selection_source=selection_source,
            capabilities=capabilities,
            has_image_input=request.has_image_input,
            requires_vision=request.requires_vision,
            projector_artifact_id=projector_artifact_id,
            provider_id="llama-cpp",
            reason=reasons,
            fallback_policy="strict",
            decision_settings_revision=settings.revision,
        )

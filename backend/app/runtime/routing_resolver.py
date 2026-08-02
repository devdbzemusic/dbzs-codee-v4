import uuid
from app.runtime.schemas import RuntimeRouteRequest, RuntimeRouteResponse
from app.settings.service import SettingsService
from app.models.index_service import ModelIndexService

class FleetRoutingResolver:
    def __init__(self, settings_service: SettingsService, index_service: ModelIndexService):
        self.settings = settings_service
        self.index = index_service

    def resolve(self, request: RuntimeRouteRequest) -> RuntimeRouteResponse:
        settings = self.settings.load()
        
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
            if settings.defaultCoderModelId: # Fallback to coder for tester
                configured_model_id = settings.defaultCoderModelId
            slot_id = "fast_gpu"
            
        # 2. Vision override
        if request.requires_vision:
            target_agent = "vision"
            slot_id = "vision_gpu"
            if settings.defaultVisionModelId:
                configured_model_id = settings.defaultVisionModelId
                
        # 3. Manual override
        if request.manual_model_id:
            configured_model_id = request.manual_model_id

        # 4. Resolve Model from Index
        resolved_model_id = configured_model_id
        resolved_model_name = "Unknown Model"
        capabilities = []
        projector_artifact_id = None
        
        index_data = self.index.load_cached_index() or self.index.build_index()
        if resolved_model_id:
            for model in index_data.models:
                if model.id == resolved_model_id:
                    resolved_model_name = model.name
                    capabilities = model.capabilities
                    break
                    
        if request.requires_vision and resolved_model_id:
            # find mmproj pair
            for pair in index_data.multimodal_pairs:
                if pair.model_artifact_id == resolved_model_id:
                    projector_artifact_id = pair.support_artifact_id
                    break

        return RuntimeRouteResponse(
            decision_id=str(uuid.uuid4()),
            task_type=task,
            target_agent=target_agent,
            slot_id=slot_id,
            model_id=resolved_model_id if resolved_model_id else "",
            model_name=resolved_model_name,
            configured_model_id=configured_model_id if configured_model_id else "",
            resolved_model_id=resolved_model_id if resolved_model_id else "",
            resolved_model_name=resolved_model_name,
            selection_source="role_setting",
            capabilities=capabilities,
            has_image_input=request.has_image_input,
            requires_vision=request.requires_vision,
            projector_artifact_id=projector_artifact_id,
            provider_id="llama-cpp",
            reason=["Routed via Backend FleetRoutingResolver"],
            fallback_policy="strict",
            decision_settings_revision=settings.revision
        )

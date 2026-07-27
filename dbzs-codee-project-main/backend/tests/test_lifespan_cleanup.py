import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from app.main import lifespan


@pytest.mark.anyio
async def test_lifespan_cleanup_success():
    # Mock services
    mock_multi_server_manager = AsyncMock()
    mock_runtime_service = MagicMock()
    app = FastAPI()
    
    # Patch all required imports/calls inside the lifespan handler
    with patch("app.api.model_profiles._multi_server_manager", mock_multi_server_manager), \
         patch("app.api.runtime.get_runtime_service", return_value=mock_runtime_service), \
         patch("app.main.terminate_cleanup_candidates", side_effect=[[1234]]) as mock_cleanup:
         
        # Execute the lifespan using async context manager
        async with lifespan(app):
            # Startup phase (yields)
            pass
            
        # Shutdown phase runs after exiting context
        mock_multi_server_manager.stop_profile.assert_awaited_once()
        mock_runtime_service.stop_model.assert_called_once()
        assert mock_cleanup.call_count == 1

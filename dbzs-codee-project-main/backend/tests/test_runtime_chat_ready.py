"""
P1 Phase 4: Tests for slot chat_ready determination.

Tests verify that chat_ready is calculated correctly based on:
- Slot state (must be "running")
- Endpoint availability (must be reachable)
- Service readiness check
"""

import pytest
from pathlib import Path
from app.runtime.service import RuntimeService
from app.runtime.schemas import RuntimeStatus


def fake_endpoint_checker_available(url: str) -> bool:
    """Fake checker that always reports endpoint as available."""
    return True


def fake_endpoint_checker_unavailable(url: str) -> bool:
    """Fake checker that always reports endpoint as unavailable."""
    return False


class TestSlotChatReady:
    """Test suite for slot chat readiness calculation."""

    def test_running_slot_with_reachable_endpoint_is_chat_ready(self):
        """
        P1 Requirement: A running slot with reachable endpoint is chat_ready.
        """
        service = RuntimeService(
            endpoint_checker=fake_endpoint_checker_available,
            simulation_mode=True,
        )
        
        # Simulate a running slot with endpoint
        slot_id = "fast_gpu"
        service._statuses[slot_id] = RuntimeStatus(
            state="running",
            slot_id=slot_id,
            model_id="test-model",
            model_name="Test Model",
            endpoint="http://localhost:8000",
            provider="llama.cpp",
            port=8000,
            pid=1234,
        )
        
        # Check: slot should be chat_ready
        assert service.is_slot_chat_ready(slot_id) is True

    def test_running_slot_without_endpoint_is_not_chat_ready(self):
        """
        P1 Requirement: A running slot without endpoint is NOT chat_ready.
        """
        service = RuntimeService(
            endpoint_checker=fake_endpoint_checker_available,
            simulation_mode=True,
        )
        
        slot_id = "quality_cpu"
        service._statuses[slot_id] = RuntimeStatus(
            state="running",
            slot_id=slot_id,
            model_id="test-model",
            model_name="Test Model",
            endpoint=None,  # No endpoint!
            provider="llama.cpp",
            port=None,
            pid=1234,
        )
        
        # Check: slot should NOT be chat_ready
        assert service.is_slot_chat_ready(slot_id) is False

    def test_running_slot_with_unreachable_endpoint_is_not_chat_ready(self):
        """
        P1 Requirement: Endpoint must be reachable for chat_ready.
        """
        service = RuntimeService(
            endpoint_checker=fake_endpoint_checker_unavailable,
            simulation_mode=True,
        )
        
        slot_id = "utility"
        service._statuses[slot_id] = RuntimeStatus(
            state="running",
            slot_id=slot_id,
            model_id="test-model",
            model_name="Test Model",
            endpoint="http://localhost:9999",  # Unreachable
            provider="llama.cpp",
            port=9999,
            pid=1234,
        )
        
        # Check: slot should NOT be chat_ready (unreachable)
        assert service.is_slot_chat_ready(slot_id) is False

    def test_stopped_slot_is_not_chat_ready(self):
        """
        P1 Requirement: Stopped slots are never chat_ready.
        """
        service = RuntimeService(
            endpoint_checker=fake_endpoint_checker_available,
            simulation_mode=True,
        )
        
        slot_id = "fast_gpu"
        service._statuses[slot_id] = RuntimeStatus(
            state="stopped",
            slot_id=slot_id,
            message="Runtime not running",
        )
        
        # Check: slot should NOT be chat_ready
        assert service.is_slot_chat_ready(slot_id) is False

    def test_starting_slot_is_not_chat_ready(self):
        """
        P1 Requirement: Slots still starting are not immediately chat_ready.
        """
        service = RuntimeService(
            endpoint_checker=fake_endpoint_checker_available,
            simulation_mode=True,
        )
        
        slot_id = "quality_cpu"
        service._statuses[slot_id] = RuntimeStatus(
            state="starting",
            slot_id=slot_id,
            model_id="test-model",
            endpoint="http://localhost:8000",
        )
        
        # Check: slot should NOT be chat_ready (still starting)
        assert service.is_slot_chat_ready(slot_id) is False

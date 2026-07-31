from app.runtime.gpu_exclusivity import other_exclusive_gpu_slot, wait_for_slot_drain


def test_other_exclusive_gpu_slot_pairs_fast_and_vision() -> None:
    assert other_exclusive_gpu_slot("fast_gpu") == "vision_gpu"
    assert other_exclusive_gpu_slot("vision_gpu") == "fast_gpu"


def test_other_exclusive_gpu_slot_is_none_for_non_gpu_slots() -> None:
    assert other_exclusive_gpu_slot("quality_cpu") is None
    assert other_exclusive_gpu_slot("utility") is None
    assert other_exclusive_gpu_slot("orchestrator_cpu") is None


def test_wait_for_slot_drain_returns_immediately_when_already_idle() -> None:
    assert wait_for_slot_drain(lambda _slot_id: 0, "fast_gpu", timeout_seconds=5.0) is True


def test_wait_for_slot_drain_polls_until_active_requests_reach_zero() -> None:
    calls = {"count": 0}

    def get_active_requests(_slot_id: str) -> int:
        calls["count"] += 1
        return 0 if calls["count"] >= 3 else 1

    result = wait_for_slot_drain(get_active_requests, "vision_gpu", timeout_seconds=5.0, poll_interval_seconds=0.01)

    assert result is True
    assert calls["count"] >= 3


def test_wait_for_slot_drain_gives_up_after_timeout() -> None:
    result = wait_for_slot_drain(lambda _slot_id: 1, "fast_gpu", timeout_seconds=0.05, poll_interval_seconds=0.01)

    assert result is False

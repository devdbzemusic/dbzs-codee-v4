from app.runtime.slot_contract import load_slot_contract, slot_id_for_port, slot_port


def test_slot_contract_has_four_slots_with_unique_ports() -> None:
    contract = load_slot_contract()
    slots = contract["slots"]

    ids = {entry["id"] for entry in slots}
    assert ids == {"quality_cpu", "fast_gpu", "utility", "orchestrator_cpu"}

    ports = [entry["port"] for entry in slots]
    assert len(ports) == len(set(ports))


def test_orchestrator_cpu_slot_is_cpu_on_port_8084() -> None:
    contract = load_slot_contract()
    orchestrator = next(entry for entry in contract["slots"] if entry["id"] == "orchestrator_cpu")

    assert orchestrator["port"] == 8084
    assert orchestrator["devicePolicy"] == "cpu"


def test_slot_port_resolves_orchestrator_cpu() -> None:
    assert slot_port("orchestrator_cpu") == 8084


def test_slot_id_for_port_resolves_orchestrator_cpu() -> None:
    assert slot_id_for_port(8084) == "orchestrator_cpu"

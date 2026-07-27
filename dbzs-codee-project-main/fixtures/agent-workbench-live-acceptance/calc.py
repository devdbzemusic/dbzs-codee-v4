def add(a: float, b: float) -> float:
    # BUG: Sollte a + b sein, ist aber fälschlicherweise eine Subtraktion.
    return a - b

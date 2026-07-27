from app.core.secret_redaction import redact_text, redact_value


def test_redacts_nested_secrets_without_repeating_values():
    source = {"authorization": "Bearer EXAMPLE_VALUE", "nested": {"api_key": "EXAMPLE_KEY"}}
    redacted = redact_value(source)
    assert redacted["authorization"] == "[REDACTED]"
    assert redacted["nested"]["api_key"] == "[REDACTED]"


def test_redacts_bearer_and_private_key_blocks():
    value = "Bearer EXAMPLE_TOKEN\n-----BEGIN PRIVATE KEY-----\nEXAMPLE\n-----END PRIVATE KEY-----"
    result = redact_text(value)
    assert "EXAMPLE_TOKEN" not in result
    assert "BEGIN PRIVATE KEY" not in result


def test_redacts_suffix_style_token_fields():
    value = "my_token=abc123\nclient_secret=xyz789"
    result = redact_text(value)
    assert "abc123" not in result
    assert "xyz789" not in result

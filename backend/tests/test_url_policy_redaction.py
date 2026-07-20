from backend.core.redaction import redact_secrets, redact_text, redact_url
from backend.core.url_policy import (
    URLPolicyError,
    validate_official_provider_url,
    validate_remote_asset_url,
    validate_remote_relay_url,
)


def test_url_policy_allows_official_https_provider():
    result = validate_official_provider_url("https://api.openai.com/v1", "openai")
    assert result.ok is True
    assert result.category == "official:openai"


def test_url_policy_blocks_remote_http():
    try:
        validate_remote_relay_url("http://relay.example.com/v1")
    except URLPolicyError as exc:
        assert "HTTPS" in exc.reason
    else:
        raise AssertionError("remote HTTP should be blocked")


def test_url_policy_blocks_non_http_protocols():
    for url in ("file:///tmp/key", "ftp://example.com/api"):
        try:
            validate_remote_relay_url(url)
        except URLPolicyError:
            pass
        else:
            raise AssertionError(f"{url} should be blocked")


def test_url_policy_blocks_sensitive_query_params():
    try:
        validate_remote_relay_url("https://relay.example.com/v1?api_key=secret")
    except URLPolicyError as exc:
        assert "敏感参数" in exc.reason
    else:
        raise AssertionError("query api_key should be blocked")


def test_url_policy_blocks_metadata_and_private_addresses():
    for url in ("https://169.254.169.254/latest", "https://192.168.1.20/v1"):
        try:
            validate_remote_relay_url(url)
        except URLPolicyError:
            pass
        else:
            raise AssertionError(f"{url} should be blocked")


def test_url_policy_allows_https_relay_with_risk():
    result = validate_remote_relay_url("https://relay.example.com/v1")
    assert result.ok is True
    assert result.category == "relay"
    assert result.risk_level == "relay_risk"


def test_provider_asset_url_blocks_ssrf_and_embedded_credentials():
    for url in (
        "http://cdn.example.com/image.png",
        "https://127.0.0.1/image.png",
        "https://169.254.169.254/latest/meta-data",
        "https://user:password@cdn.example.com/image.png",
    ):
        try:
            validate_remote_asset_url(url)
        except URLPolicyError:
            pass
        else:
            raise AssertionError(f"{url} should be blocked")


def test_redact_secrets_covers_keys_headers_tokens_and_paths():
    raw = (
        "Authorization: Bearer sk-test-secret api_key=abc123 "
        "https://relay.example.com/v1?token=tok123&room=1 "
        "C:\\Users\\example\\client\\room.png "
        "C:\\Users\\example\\havenframe\\workspace\\projects\\client-a"
    )
    redacted = redact_text(raw)
    assert redacted is not None
    assert "sk-test-secret" not in redacted
    assert "abc123" not in redacted
    assert "tok123" not in redacted
    assert "C:\\Users\\example" not in redacted
    assert "[REDACTED]" in redacted


def test_redact_url_masks_sensitive_query_only():
    assert redact_url("https://relay.example.com/v1?key=abc&room=1") == "https://relay.example.com/v1?key=[REDACTED]&room=1"


def test_redact_mapping_masks_sensitive_values():
    payload = redact_secrets({"Authorization": "Bearer secret", "nested": {"access_token": "tok"}})
    assert payload["Authorization"] == "[REDACTED]"
    assert payload["nested"]["access_token"] == "[REDACTED]"

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

from app.core.config import get_settings

PREFIX = "enc:v1:"
DEFAULT_KEY_ID = "default"


def mask_value(value: Any) -> Any:
    if value is None:
        return value
    text = str(value)
    if not text:
        return text
    visible = min(4, max(0, len(text) // 3))
    if visible == 0:
        return "*" * len(text)
    return f"{'*' * max(0, len(text) - visible)}{text[-visible:]}"


def encrypt_value(value: Any, key_id: str | None = None) -> Any:
    if value is None or value == "":
        return value
    text = value if isinstance(value, str) else json.dumps(value, default=str, separators=(",", ":"))
    if text.startswith(PREFIX):
        return text
    normalized_key_id = _normalize_key_id(key_id)
    nonce = secrets.token_bytes(16)
    key = _pii_key(normalized_key_id)
    plain = text.encode("utf-8")
    stream = _keystream(key, nonce, len(plain))
    cipher = bytes(byte ^ stream[index] for index, byte in enumerate(plain))
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    payload = base64.urlsafe_b64encode(nonce + tag + cipher).decode("ascii")
    return f"{PREFIX}{normalized_key_id}:{payload}"


def decrypt_value(value: Any, key_id: str | None = None) -> Any:
    if not isinstance(value, str) or not value.startswith(PREFIX):
        return value
    key_part, payload_part = _split_ciphertext(value)
    normalized_key_id = _normalize_key_id(key_id or key_part)
    payload = base64.urlsafe_b64decode(payload_part.encode("ascii"))
    nonce, tag, cipher = payload[:16], payload[16:32], payload[32:]
    key = _pii_key(normalized_key_id)
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected):
        raise ValueError("PII ciphertext failed integrity check")
    stream = _keystream(key, nonce, len(cipher))
    plain = bytes(byte ^ stream[index] for index, byte in enumerate(cipher))
    return plain.decode("utf-8")


def _split_ciphertext(value: str) -> tuple[str, str]:
    body = value[len(PREFIX):]
    if ":" not in body:
        return DEFAULT_KEY_ID, body
    key_id, payload = body.split(":", 1)
    return _normalize_key_id(key_id), payload


def _normalize_key_id(key_id: str | None) -> str:
    cleaned = "".join(char for char in str(key_id or DEFAULT_KEY_ID).strip() if char.isalnum() or char in {"_", "-"})
    return cleaned or DEFAULT_KEY_ID


def _pii_key(key_id: str = DEFAULT_KEY_ID) -> bytes:
    settings = get_settings()
    key_map = _pii_key_map(settings.pii_encryption_keys)
    configured = key_map.get(key_id) or key_map.get(DEFAULT_KEY_ID) or settings.pii_encryption_key or settings.bootstrap_admin_password or settings.metadata_database_url
    return hashlib.sha256(str(configured).encode("utf-8")).digest()


def _pii_key_map(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {_normalize_key_id(str(key)): str(value) for key, value in parsed.items() if value is not None}


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(output[:length])

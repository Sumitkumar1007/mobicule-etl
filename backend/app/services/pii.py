import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

from app.core.config import get_settings

PREFIX = "enc:v1:"


def configured_pii_columns(config: dict[str, Any]) -> list[str]:
    raw = config.get("pii_columns") or config.get("pii_mask_columns") or []
    if isinstance(raw, str):
        return [item.strip() for item in raw.split(",") if item.strip()]
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return []


def encrypt_pii_rows(rows: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    columns = configured_pii_columns(config)
    if not columns:
        return rows
    return [_with_pii(row, columns, encrypt_value) for row in rows]


def mask_pii_rows(rows: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    columns = configured_pii_columns(config)
    if not columns:
        return rows
    return [_with_pii(row, columns, mask_value) for row in rows]


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


def encrypt_value(value: Any) -> Any:
    if value is None or value == "":
        return value
    text = value if isinstance(value, str) else json.dumps(value, default=str, separators=(",", ":"))
    if text.startswith(PREFIX):
        return text
    nonce = secrets.token_bytes(16)
    key = _pii_key()
    plain = text.encode("utf-8")
    stream = _keystream(key, nonce, len(plain))
    cipher = bytes(byte ^ stream[index] for index, byte in enumerate(plain))
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    return PREFIX + base64.urlsafe_b64encode(nonce + tag + cipher).decode("ascii")


def decrypt_value(value: Any) -> Any:
    if not isinstance(value, str) or not value.startswith(PREFIX):
        return value
    payload = base64.urlsafe_b64decode(value[len(PREFIX):].encode("ascii"))
    nonce, tag, cipher = payload[:16], payload[16:32], payload[32:]
    key = _pii_key()
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(tag, expected):
        raise ValueError("PII ciphertext failed integrity check")
    stream = _keystream(key, nonce, len(cipher))
    plain = bytes(byte ^ stream[index] for index, byte in enumerate(cipher))
    return plain.decode("utf-8")


def _with_pii(row: dict[str, Any], columns: list[str], handler) -> dict[str, Any]:
    next_row = dict(row)
    for column in columns:
        if column in next_row:
            next_row[column] = handler(next_row[column])
    return next_row


def _pii_key() -> bytes:
    settings = get_settings()
    configured = settings.pii_encryption_key or settings.bootstrap_admin_password or settings.metadata_database_url
    return hashlib.sha256(str(configured).encode("utf-8")).digest()


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(output[:length])

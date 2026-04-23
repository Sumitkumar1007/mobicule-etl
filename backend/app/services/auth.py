import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import hash_token, verify_password
from app.db.database import db
from app.models.schemas import User, UserRole


def login(email: str, password: str) -> tuple[str, User]:
    with db() as conn:
        row = conn.execute("SELECT id, name, email, role, password_hash, created_at FROM users WHERE email=?", (email,)).fetchone()
    if row is None or not verify_password(password, dict(row).get("password_hash")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    user = User(**{key: value for key, value in dict(row).items() if key != "password_hash"})
    token = secrets.token_urlsafe(48)
    token_hash = hash_token(token)
    expires_at = datetime.now(UTC) + timedelta(hours=get_settings().auth_token_ttl_hours)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
            """,
            (user.id, token_hash, expires_at.isoformat()),
        )
    return token, user


def logout(token: str) -> None:
    with db() as conn:
        conn.execute(
            "UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND revoked_at IS NULL",
            (_hash_token(token),),
        )


def user_from_token(token: str) -> User | None:
    with db() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.name, u.email, u.role, u.created_at
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at::timestamptz > CURRENT_TIMESTAMP
            """,
            (_hash_token(token),),
        ).fetchone()
    return User(**dict(row)) if row else None


def bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()


def current_user(request: Request) -> User:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


def require_role(request: Request, roles: set[UserRole]) -> User:
    user = current_user(request)
    if user.role not in roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permission")
    return user


def _hash_token(token: str) -> str:
    return hash_token(token)

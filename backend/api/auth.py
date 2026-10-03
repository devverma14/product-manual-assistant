"""
Authentication & JWT Verification for Product Manual Assistant.

Enforces per-user ownership and verifies Supabase JWT tokens.
Supports authenticated users and guest sessions.
Supports HS256, ES256, and RS256 token verification via JWKS.
"""

import logging
import os
from typing import Any

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

ALLOWED_ALGORITHMS = ["HS256", "ES256", "RS256"]

# Module-level cache for PyJWKClient instance
_jwks_client_cache: dict[str, PyJWKClient] = {}


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Retrieve or create a cached PyJWKClient instance for the given JWKS URL."""
    if jwks_url not in _jwks_client_cache:
        _jwks_client_cache[jwks_url] = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client_cache[jwks_url]


def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> dict[str, Any]:
    """
    Extract user details from Supabase JWT if present.
    Fallback to a scoped guest session if unauthenticated.
    """
    if not credentials or not credentials.credentials:
        guest_id = request.headers.get("x-guest-session-id", "guest_user").strip()
        if not guest_id or not guest_id.startswith("guest"):
            guest_id = "guest_user"
        return {
            "id": guest_id,
            "email": "guest@local",
            "full_name": "Guest User",
            "is_guest": True,
        }

    token = credentials.credentials

    # Step 1: Inspect unverified header to select strictly allowlisted algorithm
    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        logger.warning("Failed to parse JWT header: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed authentication token.",
        ) from exc

    alg = header.get("alg")
    if not alg or alg not in ALLOWED_ALGORITHMS:
        logger.warning("Unsupported or missing JWT algorithm: %s", alg)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unsupported JWT algorithm '{alg}'.",
        )

    # Step 2: Verify signature using JWKS (for ES256/RS256) or JWT secret (for HS256)
    try:
        supabase_url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).strip().rstrip("/")

        if alg in ("ES256", "RS256"):
            if not supabase_url:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="SUPABASE_URL environment variable is not configured.",
                )
            jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
            jwk_client = _get_jwks_client(jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            key = signing_key.key

            payload = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience="authenticated",
            )
        else:  # HS256
            jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
            if not jwt_secret:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="SUPABASE_JWT_SECRET environment variable is not configured.",
                )
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )

        sub = payload.get("sub")
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: subject missing.",
            )

        return {
            "id": sub,
            "email": payload.get("email", ""),
            "full_name": payload.get("user_metadata", {}).get("full_name", payload.get("email", "User")),
            "avatar_url": payload.get("user_metadata", {}).get("avatar_url", ""),
            "is_guest": False,
        }

    except jwt.ExpiredSignatureError as exc:
        logger.warning("JWT expired: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
        ) from exc
    except jwt.PyJWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token signature or claims.",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Unexpected error during auth verification: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication verification failed.",
        ) from exc


def get_current_user(
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    """Require an authenticated user session (rejects guest if strict auth required)."""
    if user.get("is_guest"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return user


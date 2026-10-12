"""Verify Supabase user access tokens against the project's public signing keys."""

from dataclasses import dataclass
from uuid import UUID

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWTError


@dataclass(frozen=True)
class User:
    id: str


class TokenVerifier:
    def __init__(self, supabase_url: str):
        self.issuer = f"{supabase_url}/auth/v1"
        self.keys = PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json", lifespan=300, timeout=5
        )

    def verify(self, token: str) -> User:
        try:
            # Reject legacy shared-secret and unsigned tokens before any key lookup.
            if jwt.get_unverified_header(token).get("alg") not in ("ES256", "RS256"):
                raise jwt.InvalidAlgorithmError("Unsupported signing algorithm")
            key = self.keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                issuer=self.issuer,
                options={"require": ["exp", "iat", "sub", "iss", "aud", "role"]},
            )
            if claims["role"] != "authenticated" or claims.get("is_anonymous", False):
                raise jwt.InvalidTokenError("A registered user is required")
            return User(str(UUID(claims["sub"])))
        except PyJWKClientConnectionError as exc:
            raise HTTPException(
                503,
                "Sign-in verification is temporarily unavailable. Try again shortly.",
            ) from exc
        except (PyJWTError, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(
                401,
                "Your session is invalid or has expired. Please sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

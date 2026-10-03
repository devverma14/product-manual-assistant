import time
import unittest
from unittest.mock import MagicMock, patch

import jwt
from fastapi import HTTPException

from backend.api.auth import get_current_user_optional, get_current_user


class JWTAuthTests(unittest.TestCase):
    def setUp(self):
        self.secret = "test_hs256_secret_key_1234567890123456"
        self.payload = {
            "sub": "user_123456",
            "email": "user@example.com",
            "aud": "authenticated",
            "exp": int(time.time()) + 3600,
            "user_metadata": {"full_name": "Test User"},
        }

    @patch.dict("os.environ", {"SUPABASE_JWT_SECRET": "test_hs256_secret_key_1234567890123456"})
    def test_valid_hs256_token(self):
        token = jwt.encode(self.payload, self.secret, algorithm="HS256")
        req = MagicMock()
        creds = MagicMock()
        creds.credentials = token

        user = get_current_user_optional(req, creds)
        self.assertFalse(user["is_guest"])
        self.assertEqual(user["id"], "user_123456")
        self.assertEqual(user["email"], "user@example.com")
        self.assertEqual(user["full_name"], "Test User")

    @patch.dict("os.environ", {"SUPABASE_URL": "https://example.supabase.co"})
    @patch("backend.api.auth._get_jwks_client")
    def test_valid_es256_token_via_jwks(self, mock_jwks_client_fn):
        mock_jwks_client = MagicMock()
        mock_signing_key = MagicMock()
        mock_signing_key.key = "mock_public_key"
        mock_jwks_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwks_client_fn.return_value = mock_jwks_client

        token_header = {"alg": "ES256", "typ": "JWT"}
        with patch("jwt.get_unverified_header", return_value=token_header), \
             patch("jwt.decode", return_value=self.payload):
            req = MagicMock()
            creds = MagicMock()
            creds.credentials = "valid.es256.jwt"

            user = get_current_user_optional(req, creds)
            self.assertFalse(user["is_guest"])
            self.assertEqual(user["id"], "user_123456")

    @patch.dict("os.environ", {"SUPABASE_JWT_SECRET": "test_hs256_secret_key_1234567890123456"})
    def test_invalid_signature_throws_401(self):
        token = jwt.encode(self.payload, "wrong_secret_key_00000000000000", algorithm="HS256")
        req = MagicMock()
        creds = MagicMock()
        creds.credentials = token

        with self.assertRaises(HTTPException) as ctx:
            get_current_user_optional(req, creds)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("Invalid authentication token signature", ctx.exception.detail)

    @patch.dict("os.environ", {"SUPABASE_JWT_SECRET": "test_hs256_secret_key_1234567890123456"})
    def test_expired_token_throws_401(self):
        expired_payload = self.payload.copy()
        expired_payload["exp"] = int(time.time()) - 3600
        token = jwt.encode(expired_payload, self.secret, algorithm="HS256")
        req = MagicMock()
        creds = MagicMock()
        creds.credentials = token

        with self.assertRaises(HTTPException) as ctx:
            get_current_user_optional(req, creds)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("expired", ctx.exception.detail.lower())

    @patch.dict("os.environ", {"SUPABASE_JWT_SECRET": "test_hs256_secret_key_1234567890123456"})
    def test_wrong_audience_throws_401(self):
        wrong_aud_payload = self.payload.copy()
        wrong_aud_payload["aud"] = "untrusted_audience"
        token = jwt.encode(wrong_aud_payload, self.secret, algorithm="HS256")
        req = MagicMock()
        creds = MagicMock()
        creds.credentials = token

        with self.assertRaises(HTTPException) as ctx:
            get_current_user_optional(req, creds)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_unsupported_algorithm_throws_401(self):
        with patch("jwt.get_unverified_header", return_value={"alg": "none"}):
            req = MagicMock()
            creds = MagicMock()
            creds.credentials = "token.with.none"

            with self.assertRaises(HTTPException) as ctx:
                get_current_user_optional(req, creds)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertIn("Unsupported JWT algorithm", ctx.exception.detail)

    def test_missing_credentials_fallback_to_guest(self):
        req = MagicMock()
        req.headers.get.return_value = "guest_session_abc"
        user = get_current_user_optional(req, None)
        self.assertTrue(user["is_guest"])
        self.assertEqual(user["id"], "guest_session_abc")

    def test_strict_auth_rejects_guest(self):
        guest_user = {"id": "guest_user", "is_guest": True}
        with self.assertRaises(HTTPException) as ctx:
            get_current_user(guest_user)
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()

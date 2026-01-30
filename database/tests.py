from django.test import SimpleTestCase

from database.models import SubstituteAccessToken


class SubstituteAccessTokenTests(SimpleTestCase):
    def test_hash_token_is_sha256_hex(self):
        raw = "test-token"
        hashed = SubstituteAccessToken.hash_token(raw)
        self.assertEqual(len(hashed), 64)
        self.assertNotEqual(raw, hashed)

    def test_generate_raw_token_is_not_empty(self):
        raw = SubstituteAccessToken.generate_raw_token()
        self.assertTrue(raw)
        self.assertGreaterEqual(len(raw), 16)

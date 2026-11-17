import ast
import unittest
from pathlib import Path
from scripts.apply_owned_wallets import patch


class OwnedInstallerTests(unittest.TestCase):
    def test_patch_is_idempotent_and_preserves_unrelated_backend(self):
        current = Path('wallet_backend.py').read_text()
        self.assertEqual(patch(current), current)
        ast.parse(current)
        self.assertIn("custody_route(request, action, uid, custody)", current)

    def test_unknown_release_is_rejected_before_writing(self):
        with self.assertRaises(ValueError):
            patch('import asyncio\n# unrelated server')

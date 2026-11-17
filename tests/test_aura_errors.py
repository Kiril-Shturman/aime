import unittest
from types import SimpleNamespace
from wallet_aura_errors import CATALOG, recovery, retry_policy, wallet_error_payload


class AuraErrorsTests(unittest.TestCase):
    def test_catalog_is_complete_and_has_recovery(self):
        self.assertEqual(len(CATALOG), 66)
        for code in CATALOG:
            self.assertTrue(CATALOG[code]['message'])
            self.assertIn(retry_policy(code, 400), {'no', 'after_fix', 'wait', 'after_delay', 'later'})

    def test_recovery_is_not_just_http_status(self):
        self.assertEqual(retry_policy('sbp_buy_pending_qr_limit', 429), 'no')
        self.assertEqual(retry_policy('rate_limited', 429), 'after_delay')
        self.assertEqual(retry_policy('resource_exhausted', 429), 'after_delay')
        self.assertEqual(retry_policy('card_frozen', 409), 'after_fix')
        self.assertEqual(recovery('unavailable'), 'same_request')
        self.assertEqual(recovery('kyc_session_unavailable', {'status': 'pending'}), 'wait')
        self.assertEqual(recovery('kyc_session_unavailable', {'reason': 'access_locked_contact_manager'}), 'fix')

    def test_envelope_is_bounded_and_does_not_expose_provider_objects(self):
        error = SimpleNamespace(name='kyc_rejected', detail='Rejected', status=422, provider='aura',
            provider_type='kyc_error', param='passport', request_id='req-1',
            details={'reason': 'checks_failed', 'terminal': True, 'status': 'rejected',
                     'customer_id': 'private', 'passport': 'private', 'api_key': 'private',
                     'nested': {'secret': 'private'}})
        body = wallet_error_payload(error)
        self.assertEqual(body['error']['details'], {'reason': 'checks_failed', 'terminal': True, 'status': 'rejected'})
        self.assertEqual(body['error']['request_id'], 'req-1')
        self.assertEqual(body['error']['retry_policy'], 'no')
        error.detail = 'ak_test_SECRET whsec_SECRET'
        self.assertNotIn('SECRET', wallet_error_payload(error)['detail'])

    def test_other_providers_keep_their_existing_envelope(self):
        error = SimpleNamespace(name='OTHER_ERROR', detail='Ошибка', status=400)
        self.assertEqual(wallet_error_payload(error), {'ok': False, 'error': {'name': 'OTHER_ERROR'}, 'detail': 'Ошибка'})


class ReleasePatchTests(unittest.TestCase):
    def test_patch_fails_closed_and_preserves_hardlinked_source(self):
        import os
        import subprocess
        import tempfile
        from pathlib import Path
        from scripts.apply_aura_error_handling import apply
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for filename in ('wallet_backend.py', 'wallet_aura.py'):
                content = subprocess.check_output(['git', 'show', '78551da:' + filename], text=True)
                original = root / (filename + '.original')
                original.write_text(content)
                os.link(original, root / filename)
            apply(root)
            self.assertNotIn('wallet_error_payload', (root / 'wallet_backend.py.original').read_text())
            self.assertIn('wallet_error_payload(error)', (root / 'wallet_backend.py').read_text())
            with self.assertRaises(AssertionError):
                apply(root)

class AuraTransportErrorsTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_preserves_metadata_and_default_retry_delay(self):
        from wallet_aura import AuraClient
        class Error(Exception):
            def __init__(self, name, detail, status, retry_after):
                self.name, self.detail, self.status, self.retry_after = name, detail, status, retry_after
        client = AuraClient('', 'test', Error)
        response = SimpleNamespace(status=429, headers={})
        error = client._error(response, {'error': {'code': 'resource_exhausted', 'type': 'invalid_request_error',
            'param': 'amount', 'request_id': 'req-3', 'details': {'limit': '100'}}})
        self.assertEqual(error.retry_after, '60')
        self.assertEqual(error.param, 'amount')
        self.assertEqual(error.request_id, 'req-3')
        self.assertEqual(wallet_error_payload(error)['error']['details']['limit'], '100')
        response.headers = {'Retry-After': '2'}
        error = client._error(response, {'error': {'code': 'sbp_buy_pending_qr_limit'}})
        self.assertIsNone(error.retry_after)
        self.assertEqual(error.retry_policy, 'no')


if __name__ == "__main__":
    unittest.main()

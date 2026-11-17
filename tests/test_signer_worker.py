import base64
import copy
import json
import time
import unittest
from unittest.mock import patch

from tests import test_exchange_funding as fixtures

try:
    from wallet_signer_worker import Controller
    from wallet_signer_chains import PaymentError
    SIGNER_AVAILABLE = True
except ImportError:
    SIGNER_AVAILABLE = False


class FakeChains:
    def __init__(self):
        self.sign_count = 0; self.sent = []; self.received = False; self.timeout = False
    def estimate(self, network, source, recipient, amount, deadline):
        return {'network': network, 'source_address': source, 'recipient': recipient, 'amount': amount,
                'max_fee': '0.001', 'fee_currency': 'BNB', 'expires_at': time.time() + 60,
                'unsigned': {'nonce': 1}, 'token_balance': '100', 'native_balance': '1'}
    def sign(self, quote, key):
        self.sign_count += 1; return {'raw': 'canonical-signed-bytes'}, '1' * 64
    def verify(self, quote, payload, txid):
        if payload != {'raw': 'canonical-signed-bytes'} or txid != '1' * 64: raise ValueError('bad')
    def broadcast(self, quote, payload, txid):
        self.sent.append((copy.deepcopy(payload), txid))
        if self.timeout: raise TimeoutError()
    def receipt(self, quote, txid): return self.received


@unittest.skipUnless(SIGNER_AVAILABLE, 'Isolated signer dependencies required')
class SignerWorkerTests(unittest.TestCase):
    setUp = fixtures.FundingTests.setUp
    tearDown = fixtures.FundingTests.tearDown
    def payload(self, order):
        return {'id': 'ABC123', 'type': 'float', 'status': 'NEW',
                'time': {'reg': int(time.time()), 'update': int(time.time()), 'expiration': int(time.time() + 1800)},
                'from': {'code': 'USDTBSC', 'coin': 'USDT', 'network': 'BSC', 'amount': '100', 'address': self.pay, 'tag': None, 'tx': {}},
                'to': {'code': 'USDTTRC', 'coin': 'USDT', 'network': 'TRX', 'amount': '99', 'address': self.destination, 'tag': None, 'tx': {}}}

    def controller(self, chains, bridge_call=None):
        config = {'worker_id': self.worker, 'private_key_file': self.keys['private_file']}
        return Controller(config, bridge=bridge_call or (lambda body: __import__('wallet_signer_bridge').bridge(self.ledger.db, body)), chains=chains, fetch=self.payload)

    def job(self):
        return self.ledger.db.execute('SELECT * FROM custody_funding_jobs').fetchone()

    def due(self):
        self.ledger.db.execute('UPDATE custody_funding_jobs SET lease_until=0,next_attempt_at=0')

    def test_timeout_restart_reuses_persisted_transaction(self):
        chains = FakeChains(); controller = self.controller(chains)
        job = self.funding.estimate('tg:1', self.intent)
        controller.cycle(); self.assertEqual(self.job()['state'], 'quoted')
        quote = json.loads(self.job()['quote'])
        self.funding.confirm('tg:1', job['job_id'], quote['approval_id'])
        chains.timeout = True
        controller.cycle(); self.assertEqual(self.job()['state'], 'unknown')
        self.assertEqual(chains.sign_count, 1)
        self.due(); chains.timeout = False
        restarted = self.controller(chains); restarted.cycle()
        self.assertEqual(chains.sign_count, 1); self.assertEqual(chains.sent[0], chains.sent[1])
        self.due(); chains.received = True; restarted.cycle()
        self.assertEqual(self.job()['state'], 'done'); self.assertEqual(chains.sign_count, 1)

    def test_persisted_signed_ack_lost_does_not_broadcast_until_recovered(self):
        chains = FakeChains()
        def remote(body):
            response = __import__('wallet_signer_bridge').bridge(self.ledger.db, body)
            if body['op'] == 'signed': raise TimeoutError()
            return response
        controller = self.controller(chains, remote)
        job = self.funding.estimate('tg:1', self.intent); controller.cycle()
        self.funding.confirm('tg:1', job['job_id'], json.loads(self.job()['quote'])['approval_id'])
        controller.cycle()
        self.assertEqual(self.job()['state'], 'unknown'); self.assertEqual(chains.sent, [])
        self.due(); self.controller(chains).cycle()
        self.assertEqual(chains.sign_count, 1); self.assertEqual(len(chains.sent), 1)

    def test_tampered_quote_or_owner_never_signs(self):
        for field in ['quote', 'owner']:
            chains = FakeChains(); controller = self.controller(chains)
            self.ledger.db.execute('DELETE FROM custody_funding_jobs')
            job = self.funding.estimate('tg:1', self.intent); controller.cycle()
            quote = json.loads(self.job()['quote'])
            self.funding.confirm('tg:1', job['job_id'], quote['approval_id'])
            if field == 'quote':
                quote['recipient'] = '0x' + '9' * 40
                self.ledger.db.execute('UPDATE custody_funding_jobs SET quote=?', (json.dumps(quote),))
            else:
                # The independently fetched provider order no longer matches our destination.
                original = controller.fetch
                def changed(order):
                    value = original(order); value['to']['address'] = self.pay; return value
                controller.fetch = changed
            controller.cycle()
            self.assertEqual(chains.sign_count, 0); self.assertEqual(chains.sent, [])
            self.assertEqual(self.job()['state'], 'failed')

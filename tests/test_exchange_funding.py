import base64
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from wallet_backend import Ledger, ApiError
from wallet_custody import Custody, prepare as prepare_custody, derive
from wallet_custody_tools import init_key
from wallet_exchange_funding import Funding
from wallet_fixedfloat_orders import Orders
from wallet_signer_bridge import bridge


class FundingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(self.temp.name + '/db')
        self.ledger.account('tg:1'); self.ledger.account('tg:2')
        prepare_custody(self.ledger)
        keys = init_key(self.temp.name + '/keys')
        self.keys = keys
        self.custody = Custody(self.ledger, ApiError, enabled=True, public_key_file=keys['public_file'], chain_env='mainnet')
        self.orders = Orders(self.ledger, SimpleNamespace(error=ApiError, orders_enabled=False, configured=True), True)
        self.funding = Funding(self.ledger, self.orders, self.custody, True)
        self.worker = 'test-worker-01'
        bridge(self.ledger.db, {'op': 'heartbeat', 'worker_id': self.worker, 'networks': ['BSC', 'TRON', 'ETH'], 'key_id': keys['key_id']})
        self.intent = 'a' * 32
        self.destination = derive(b'2' * 32, 'TRON', 'mainnet')['address']
        self.pay = derive(b'3' * 32, 'BSC', 'mainnet')['address']
        self.params = {'from_network': 'BSC', 'to_network': 'TRON', 'amount': '100', 'rate_type': 'float', 'to_address': self.destination, 'to_tag': None}
        self.snapshot = {'status': 'NEW', 'expires_at': int(time.time() + 1800), 'pay_address': self.pay, 'from_amount': '100'}
        self.ledger.db.execute('INSERT INTO fixedfloat_order_intents(id,user_id,fingerprint,params,quote,state,provider_id,access_token,snapshot,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                               (self.intent, 'tg:1', 'fingerprint', json.dumps(self.params), '{}', 'ready', 'ABC123', 'TOKEN_SERVER_ONLY', json.dumps(self.snapshot), time.time(), time.time() + 1800))

    def tearDown(self):
        self.ledger.book.verify()
        self.ledger.db.close(); self.temp.cleanup()

    def call(self, op, **body):
        return bridge(self.ledger.db, {'op': op, 'worker_id': self.worker, **body})

    def quoted(self):
        job = self.funding.estimate('tg:1', self.intent)
        self.call('claim')
        quote = {'approval_id': 'b' * 32, 'expires_at': time.time() + 60, 'amount': '100', 'unsigned': {'secret': 'PRIVATE_UNSIGNED'}, 'seal': 'PRIVATE_SEAL', 'max_fee': '0.001', 'fee_currency': 'BNB'}
        self.call('quote', job_id=job['job_id'], quote=quote)
        return job

    def test_bnb_jobs_are_owned_and_share_the_exchange_wallet_lock(self):
        from wallet_custody_withdrawal import CustodyWithdrawal

        withdrawal = CustodyWithdrawal(self.funding, enabled=True)
        request = {"address": self.pay, "amount": "0.01"}
        with self.assertRaises(ApiError):
            withdrawal.prepare("tg:1", request)
        self.call("heartbeat", networks=["BSC", "BNB_WITHDRAWAL"], key_id=self.keys["key_id"])
        job = withdrawal.prepare("tg:1", request)
        self.assertEqual(job, withdrawal.prepare("tg:1", request))
        self.assertIsNone(withdrawal.owned("tg:2", job["job_id"]))
        with self.assertRaises(ApiError):
            self.funding.estimate("tg:1", self.intent)
        self.assertIsNone(self.call("claim")["job"])
        item = self.call("claim", native_bnb=True)
        self.assertEqual(item["withdrawal"]["recipient"].lower(), self.pay.lower())
        self.assertNotIn("order", item)
        quote = {"approval_id": "b" * 32, "expires_at": time.time() + 60}
        self.call("quote", job_id=job["job_id"], quote=quote)
        with self.assertRaises(ApiError):
            self.funding.confirm("tg:2", job["job_id"], quote["approval_id"], native_bnb=True)
        self.assertEqual(
            self.funding.confirm("tg:1", job["job_id"], quote["approval_id"], native_bnb=True)["state"],
            "confirmed",
        )

    def test_ownership_offline_and_disabled(self):
        with self.assertRaises(ApiError): self.funding.estimate('tg:2', self.intent)
        self.ledger.db.execute('DELETE FROM custody_signer_status')
        with self.assertRaises(ApiError) as error: self.funding.estimate('tg:1', self.intent)
        self.assertEqual(error.exception.name, 'SIGNER_UNAVAILABLE')
        self.funding.enabled = False
        with self.assertRaises(ApiError): self.funding.confirm('tg:1', 'a' * 32, 'b' * 32)

    def test_estimate_idempotent_and_unique_source_lock(self):
        first = self.funding.estimate('tg:1', self.intent)
        second = self.funding.estimate('tg:1', self.intent)
        self.assertEqual(first['job_id'], second['job_id'])
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM custody_funding_jobs').fetchone()[0], 1)
        self.ledger.db.execute('UPDATE fixedfloat_order_intents SET id=? WHERE id=?', ('c' * 32, self.intent))
        with self.assertRaises(ApiError) as error: self.funding.estimate('tg:1', 'c' * 32)
        self.assertEqual(error.exception.name, 'PAYMENT_IN_PROGRESS')

    def test_confirm_requires_quote_owner_and_matching_approval(self):
        job = self.quoted()
        for uid, approval in [('tg:2', 'b' * 32), ('tg:1', 'c' * 32)]:
            with self.assertRaises(ApiError): self.funding.confirm(uid, job['job_id'], approval)
        first = self.funding.confirm('tg:1', job['job_id'], 'b' * 32)
        second = self.funding.confirm('tg:1', job['job_id'], 'b' * 32)
        self.assertEqual(first['state'], 'confirmed'); self.assertEqual(second, first)
        public = json.dumps(self.funding.status('tg:1', self.intent))
        for secret in ['PRIVATE_UNSIGNED', 'PRIVATE_SEAL', 'TOKEN_SERVER_ONLY']:
            self.assertNotIn(secret, public)

    def test_signed_cas_and_lost_ack_never_release_source(self):
        job = self.quoted(); self.funding.confirm('tg:1', job['job_id'], 'b' * 32)
        claimed = self.call('claim'); self.assertEqual(claimed['job']['state'], 'signing')
        first = self.call('signed', job_id=job['job_id'], payload={'raw': 'canonical'}, tx_hash='1' * 64)
        second = self.call('signed', job_id=job['job_id'], payload={'raw': 'different'}, tx_hash='2' * 64)
        self.assertEqual(first, second)
        self.call('status', job_id=job['job_id'], state='failed', error='SIGNER_ERROR')
        row = self.ledger.db.execute('SELECT * FROM custody_funding_jobs').fetchone()
        self.assertEqual(row['state'], 'unknown'); self.assertEqual(row['tx_hash'], '1' * 64)
        self.ledger.db.execute('UPDATE custody_funding_jobs SET lease_until=0,next_attempt_at=0')
        recovered = self.call('claim')
        self.assertEqual(recovered['job']['signed_payload'], json.dumps({'raw': 'canonical'}))
        self.assertIsNone(self.call('claim')['job'])

    def test_expired_quote_cannot_confirm_or_sign(self):
        job = self.quoted()
        self.ledger.db.execute("UPDATE custody_funding_jobs SET quote=json_set(quote,'$.expires_at',?)", (time.time() - 1,))
        with self.assertRaises(ApiError): self.funding.confirm('tg:1', job['job_id'], 'b' * 32)
        self.call('claim')
        with self.assertRaises(ValueError): self.call('signed', job_id=job['job_id'], payload={}, tx_hash='1' * 64)

    def test_no_deposit_address_requirement_and_no_ledger_spending(self):
        self.params['from_network'] = 'TRON'
        self.ledger.db.execute('UPDATE fixedfloat_order_intents SET params=?', (json.dumps(self.params),))
        job = self.funding.estimate('tg:1', self.intent)
        self.assertEqual(job['network'], 'TRON')
        self.assertEqual(str(self.ledger.balance('tg:1', 'USDT')[0]), '0')

    def test_parallel_worker_claims_have_only_one_winner(self):
        import sqlite3
        from concurrent.futures import ThreadPoolExecutor
        self.funding.estimate('tg:1', self.intent)
        def claim(index):
            db = sqlite3.connect(self.temp.name + '/db', isolation_level=None, timeout=10)
            db.row_factory = sqlite3.Row
            try:
                return bridge(db, {'op': 'claim', 'worker_id': 'parallel-worker-' + str(index)})['job'] is not None
            finally:
                db.close()
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(claim, range(8))), 1)

    def test_pending_retries_do_not_starve_other_due_jobs(self):
        job = self.funding.estimate('tg:1', self.intent)
        self.call('claim')
        self.ledger.db.execute("UPDATE custody_funding_jobs SET state='unknown',signed_payload='{}',next_attempt_at=?,lease_until=0", (time.time()-1,))
        other = self.custody.create('tg:1', 'ETH')
        self.ledger.db.execute("INSERT INTO custody_funding_jobs(id,intent_id,user_id,wallet_id,network,state,created_at,updated_at) VALUES (?,?,?,?,?,'estimating',?,?)", ('d'*32,self.intent,'tg:1',other['id'],'ETH',time.time(),time.time()))
        self.assertEqual(self.call('claim')['job']['id'], 'd'*32)

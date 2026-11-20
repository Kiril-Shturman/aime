import base64
import json
import tempfile
import time
import unittest
from types import SimpleNamespace
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from wallet_backend import Ledger,ApiError
from wallet_custody import Custody,prepare as prepare_custody
from wallet_custody_tools import init_key
from wallet_exchange_funding import prepare as prepare_funding
from wallet_key_export import prepare,route,bridge


class ExportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.tmp.name+'/db')
        for uid in ['tg:1','tg:2']:self.ledger.account(uid)
        prepare_custody(self.ledger);prepare_funding(self.ledger);prepare(self.ledger)
        self.keys=init_key(self.tmp.name+'/keys')
        self.custody=Custody(self.ledger,ApiError,enabled=True,public_key_file=self.keys['public_file'],chain_env='mainnet')
        self.wallet=self.custody.create('tg:1','ETH')
        self.ledger.db.execute('INSERT INTO custody_signer_status VALUES (?,?,?,?)',('export-worker','["ETH","BSC"]',self.keys['key_id'],time.time()))
        async def handler(request):
            try:
                # This route unit fixture supplies the identity already verified by the main API.
                return await route(request,request.match_info['action'],request.headers.get('X-Test-User','tg:1'),self.custody)
            except ApiError as e:return web.json_response({'error':e.name},status=e.status)
            except ValueError:return web.json_response({'error':'INVALID'},status=400)
        app=web.Application();app.router.add_route('*','/{action}',handler)
        self.http=TestClient(TestServer(app));await self.http.start_server()
        self.headers={'X-Telegram-Init-Data':'auth_date='+str(int(time.time()))}
        self.public=base64.b64encode(b'X'*422).decode()

    async def asyncTearDown(self):
        await self.http.close();self.ledger.book.verify();self.ledger.db.close();self.tmp.cleanup()

    async def request_job(self,headers=None,wallet=None,**extra):
        return await self.http.post('/custody-export-prepare',json={'wallet_id':wallet or self.wallet['id'],'public_key':self.public,'acknowledged':True,**extra},headers=headers or self.headers)

    async def test_stale_session_other_owner_and_old_signer_rejected(self):
        response=await self.request_job(headers={'X-Telegram-Init-Data':'auth_date=1'})
        self.assertEqual(response.status,403)
        self.assertIn('no-store',response.headers['Cache-Control'])
        response=await self.request_job(headers={**self.headers,'X-Test-User':'tg:2'})
        self.assertEqual(response.status,404)
        tron=self.custody.create('tg:1','TRON')
        response=await self.request_job(wallet=tron['id']);self.assertEqual(response.status,503)
        response=await self.request_job(acknowledged=False);self.assertEqual(response.status,400)

    async def test_no_secret_in_status_and_ciphertext_is_consumed_only_once(self):
        response=await self.request_job();self.assertEqual(response.status,200)
        job=(await response.json())['job_id']
        claimed=bridge(self.ledger.db,{'op':'export-claim','worker_id':'export-worker'})
        self.assertEqual(claimed['wallet']['id'],self.wallet['id'])
        self.assertIsNone(bridge(self.ledger.db,{'op':'export-claim','worker_id':'other-worker'})['job'])
        encrypted=base64.b64encode(b'C'*384).decode()
        bridge(self.ledger.db,{'op':'export-complete','worker_id':'export-worker','job_id':job,'ciphertext':encrypted})
        status=await self.http.get('/custody-export-status?job_id='+job,headers=self.headers)
        body=await status.json();self.assertEqual(set(body),{'job_id','state'});self.assertEqual(body['state'],'ready')
        foreign=await self.http.post('/custody-export-reveal',json={'job_id':job},headers={**self.headers,'X-Test-User':'tg:2'})
        self.assertEqual(foreign.status,404)
        first=await self.http.post('/custody-export-reveal',json={'job_id':job},headers=self.headers)
        self.assertEqual(first.headers['Cache-Control'],'no-store, private')
        self.assertEqual((await first.json())['ciphertext'],encrypted)
        second=await self.http.post('/custody-export-reveal',json={'job_id':job},headers=self.headers)
        self.assertEqual(second.status,409)
        row=self.ledger.db.execute('SELECT * FROM custody_key_exports WHERE id=?',(job,)).fetchone()
        self.assertIsNone(row['ciphertext']);self.assertEqual(row['public_key'],'')

    async def test_rate_limit_and_expiry_remove_encrypted_result(self):
        for _ in range(3):self.assertEqual((await self.request_job()).status,200)
        self.assertEqual((await self.request_job()).status,429)
        self.ledger.db.execute("UPDATE custody_key_exports SET state='ready',ciphertext='CIPHERTEXT',expires_at=?",(time.time()-1,))
        job=self.ledger.db.execute('SELECT id FROM custody_key_exports LIMIT 1').fetchone()[0]
        response=await self.http.get('/custody-export-status?job_id='+job,headers=self.headers)
        self.assertEqual((await response.json())['state'],'expired')
        self.assertFalse(self.ledger.db.execute('SELECT 1 FROM custody_key_exports WHERE ciphertext IS NOT NULL').fetchone())

    async def test_isolated_export_recovers_exact_address_without_plaintext_on_server(self):
        try:
            from wallet_signer_worker import Controller
            from Cryptodome.PublicKey import RSA
            from Cryptodome.Cipher import PKCS1_OAEP
            from Cryptodome.Hash import SHA256
            from eth_account import Account
        except ImportError:self.skipTest('Isolated signer dependencies required')
        ephemeral=RSA.generate(3072)
        self.public=base64.b64encode(ephemeral.public_key().export_key(format='DER')).decode()
        response=await self.request_job();job=(await response.json())['job_id']
        item=bridge(self.ledger.db,{'op':'export-claim','worker_id':'export-worker'})
        worker=Controller({'private_key_file':self.keys['private_file'],'worker_id':'export-worker'},bridge=lambda body:bridge(self.ledger.db,body))
        worker.process_export(item)
        row=self.ledger.db.execute('SELECT * FROM custody_key_exports WHERE id=?',(job,)).fetchone()
        self.assertEqual(row['state'],'ready')
        plaintext=PKCS1_OAEP.new(ephemeral,hashAlgo=SHA256).decrypt(base64.b64decode(row['ciphertext']))
        document=json.loads(plaintext)
        self.assertEqual(document['wallet_id'],self.wallet['id'])
        self.assertEqual(Account.from_key(bytes.fromhex(document['private_key'])).address,self.wallet['address'])
        self.assertNotIn(document['private_key'],str(dict(row)))
        self.assertNotIn(document['private_key'],json.dumps([dict(r) for r in self.ledger.db.execute('SELECT * FROM custody_activity')]))

    async def test_multichain_material_restores_same_address(self):
        try:
            from bip_utils import Base58Decoder
            from embit import ec, script, networks
            from solders.keypair import Keypair
            from tronpy.keys import PrivateKey
            from wallet_custody import derive
            from wallet_signer_worker import Controller
            from Cryptodome.PublicKey import RSA
            from Cryptodome.Cipher import PKCS1_OAEP
            from Cryptodome.Hash import SHA256
        except ImportError:
            self.skipTest("Isolated signer dependencies required")

        ephemeral = RSA.generate(3072)
        self.public = base64.b64encode(ephemeral.public_key().export_key(format="DER")).decode()
        self.ledger.db.execute("UPDATE custody_signer_status SET networks=?,heartbeat_at=?",
                               ('["MULTICHAIN_EXPORT"]', time.time()))
        worker = Controller({"private_key_file": self.keys["private_file"], "worker_id": "export-worker"},
                            bridge=lambda body: bridge(self.ledger.db, body))
        for network, key_format in (
            ("BTC", "wif"), ("SOL", "solana_keypair_base58"),
            ("TRON", "hex"), ("TON", "ton_v4r2_ed25519_seed_hex"),
        ):
            with self.subTest(network=network):
                wallet = self.custody.create("tg:1", network)
                response = await self.request_job(wallet=wallet["id"])
                self.assertEqual(response.status, 200)
                job = (await response.json())["job_id"]
                self.assertIsNone(bridge(self.ledger.db, {"op": "export-claim", "worker_id": "old-worker"})["job"])
                item = bridge(self.ledger.db, {"op": "export-claim", "worker_id": "export-worker", "multi_network": True})
                worker.process_export(item)
                row = self.ledger.db.execute("SELECT * FROM custody_key_exports WHERE id=?", (job,)).fetchone()
                self.assertEqual(row["state"], "ready")
                document = json.loads(PKCS1_OAEP.new(ephemeral, hashAlgo=SHA256).decrypt(
                    base64.b64decode(row["ciphertext"]),
                ))
                secret = document["private_key"]
                self.assertEqual(document["format"], key_format)
                if network == "BTC":
                    decoded = Base58Decoder.CheckDecode(secret)
                    self.assertEqual((decoded[0], decoded[-1]), (128, 1))
                    restored = script.p2wpkh(ec.PrivateKey(decoded[1:-1]).get_public_key()).address(networks.NETWORKS["main"])
                elif network == "SOL":
                    restored = str(Keypair.from_base58_string(secret).pubkey())
                elif network == "TRON":
                    restored = PrivateKey(bytes.fromhex(secret)).public_key.to_base58check_address()
                else:
                    restored = derive(bytes.fromhex(secret), "TON", "mainnet")["address"]
                self.assertEqual(restored, wallet["address"])
                self.assertNotIn(secret, str(dict(row)))
                self.ledger.db.execute("UPDATE custody_key_exports SET created_at=? WHERE id=?", (0, job))

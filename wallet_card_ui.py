"""User card catalogue, ownership-scoped snapshots and server-priced confirmations."""
import asyncio
import json
import time
import uuid
from collections import deque
from decimal import Decimal, localcontext
from datetime import datetime, timezone
from aiohttp import web
from wallet_tariffs import card_issue_enabled, CARD_PLANS, GOSWAP_CARD_PLANS, active as active_tariff, calculate, resolve_card_plan, storefront_positions, prepare as prepare_tariffs
from wallet_aura import _decimal, _store_card_event, _store_card_operation, _list_data


class CardUI:
    def __init__(self, ledger, service, enabled=True):
        self.enabled = enabled
        self.ledger, self.service = ledger, service
        self.client, self.environment = service.client, service.environment
        self.locks, self.checked = {}, {}
        self.refresh_calls = deque()
        self.operation_checked = {}
        self.operation_locks = {}
        self.fee_cache = None
        self.fee_lock = asyncio.Lock()
        prepare_tariffs(ledger)
        ledger.db.execute('''CREATE TABLE IF NOT EXISTS wallet_card_quotes (
            id TEXT PRIMARY KEY,user_id TEXT NOT NULL,environment TEXT NOT NULL,
            operation TEXT NOT NULL,body TEXT NOT NULL,expires_at REAL NOT NULL,used_key TEXT)''')

    def owned(self, uid, card_id):
        row = self.ledger.db.execute(
            'SELECT * FROM aura_cards WHERE user_id=? AND card_id=? AND environment=?',
            (uid, card_id, self.environment),
        ).fetchone()
        if not row:
            raise self.client.error_cls('not_found', 'Карта не найдена', 404)
        return row

    async def provider_fees(self):
        async with self.fee_lock:
            if self.fee_cache and self.fee_cache[0] > time.monotonic():
                return self.fee_cache[1]
            raw = await self.client.get_card_fees()
            if not isinstance(raw, dict) or raw.get('currency') != 'USDT':
                raise ValueError('Invalid Aura fees')
            self.fee_cache = (time.monotonic()+10, raw)
            return raw

    async def fees(self):
        raw = await self.provider_fees()
        if not isinstance(raw, dict) or raw.get('currency') != 'USDT':
            raise ValueError('Invalid Aura fees')
        plans = []
        for plan_id, plan in CARD_PLANS.items():
            provider = raw.get('open_' + plan['kind'] + '_card_fee')
            available = provider is not None and provider != ''
            provider_fee = _decimal(provider, allow_zero=True) if available else Decimal(0)
            service_fee, tariff = calculate(self.ledger, plan_id, provider_fee, operation='issue')
            plans.append({
                'plan_id': plan_id, **plan, 'available': available and tariff['version_id'] is not None and card_issue_enabled(self.ledger, plan_id),
                'tariff_configured': tariff['version_id'] is not None,
                'issue_fee': str(provider_fee + service_fee) if available and tariff['version_id'] is not None else None,
                'provider_issue_fee': str(provider_fee) if available else None,
                'service_issue_fee': str(service_fee),
                'service_recharge_pct': tariff['percent_fee'] if tariff['enabled'] else '0',
                'service_minimum_fee': tariff['minimum_fee'] if tariff['enabled'] else '0',
                'tariff_version': tariff['version_id'],
            })
        aura_plans = {plan['plan_id']: plan for plan in plans}
        storefront = []
        goswap_skins = {'goswap_card_sg_1': 'silver', 'goswap_card_sg_2': 'navy', 'goswap_card_us': 'silver'}
        ordered = sorted((position, product) for product, position in storefront_positions(self.ledger).items() if position is not None)
        for position, product in ordered:
            if product in aura_plans:
                plan = aura_plans[product]
                if plan['kind'] == 'physical' and plan['provider_issue_fee'] is None:
                    continue
                storefront.append({**plan, 'provider': 'Aura', 'position': position})
            elif product in GOSWAP_CARD_PLANS:
                terms = GOSWAP_CARD_PLANS[product]
                tariff = active_tariff(self.ledger, product)
                issue = Decimal(terms['provider_issue_fee']) + Decimal(tariff['fixed_fee'])
                recharge = Decimal(terms['provider_recharge_fee']) + Decimal(tariff['percent_fee'])
                storefront.append({
                    **terms, 'skin': goswap_skins[product],
                    'plan_id': product, 'provider': 'GoSwap', 'position': position,
                    'available': False, 'issue_fee': format(issue, 'f'),
                    'service_issue_fee': tariff['fixed_fee'],
                    'service_recharge_pct': tariff['percent_fee'],
                    'service_minimum_fee': tariff['minimum_fee'],
                    'total_recharge_pct': format(recharge.normalize(), 'f'),
                })
        return {**raw, 'plans': plans, 'storefront': storefront}

    def cards(self, uid):
        result = []
        for row in self.ledger.db.execute(
            'SELECT * FROM aura_cards WHERE user_id=? AND environment=? ORDER BY created_at DESC,card_id',
            (uid, self.environment),
        ):
            item = {key: row[key] for key in ['card_id','kind','plan_id','status','masked_pan','delivery_status','provider_updated_at']}
            item['frozen'] = bool(row['frozen'])
            _, plan = resolve_card_plan(row['plan_id'], row['kind'])
            item['skin'] = plan['skin']
            body = json.loads(row['body'])
            balance = body.get('balance')
            item['balance'] = str(_decimal(balance, allow_zero=True)) if balance is not None else None
            item['currency'] = body.get('currency', 'USDT')
            item['tracking'] = json.loads(row['tracking']) if row['tracking'] else None
            result.append(item)
        return result

    async def refresh(self, uid):
        if not self.client.configured:
            return
        lock = self.locks.setdefault(uid, asyncio.Lock())
        async with lock:
            if time.monotonic() - self.checked.get(uid, -100) < 30:
                return
            stamp = time.monotonic()
            while self.refresh_calls and self.refresh_calls[0] < stamp - 60:
                self.refresh_calls.popleft()
            if len(self.refresh_calls) >= 60:
                raise self.client.error_cls('rate_limited', 'Обновление карт временно ограничено', 429, '30')
            rows = self.cards(uid)
            if rows:
                payloads = []
                for row in rows[:10]:
                    self.refresh_calls.append(time.monotonic())
                    payloads.append(await self.client.get_card(row['card_id']))
            else:
                owner = self.ledger.db.execute(
                    'SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?',
                    (uid, self.environment),
                ).fetchone()
                if not owner:
                    self.checked[uid] = time.monotonic()
                    return
                self.refresh_calls.append(time.monotonic())
                page = await self.client.list_cards(limit=100)
                payloads = [p for p in page.get('data', []) if (p.get('owner_id') or p.get('customer_id')) == owner['customer_id']]
            owner = self.ledger.db.execute(
                'SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?',
                (uid, self.environment),
            ).fetchone()
            for payload in payloads:
                if not isinstance(payload, dict) or not owner or (payload.get('owner_id') or payload.get('customer_id')) != owner['customer_id']:
                    raise ValueError('Card owner mismatch')
                card_id = payload.get('card_id') or payload.get('id')
                if rows and card_id not in {r['card_id'] for r in rows}:
                    raise ValueError('Card identity mismatch')
                balance = payload.get('balance')
                if balance is not None:
                    _decimal(balance, allow_zero=True)
                self.ledger.begin('card_snapshot', uid, str(card_id))
                try:
                    _store_card_event(self.ledger, self.environment, 'card.snapshot', payload)
                    self.ledger.commit()
                except Exception:
                    self.ledger.rollback()
                    raise
            self.checked[uid] = time.monotonic()

    async def operations(self, uid, card_id):
        self.owned(uid,card_id)
        warning=None;key=(uid,card_id)
        if self.enabled and self.client.configured:
            async with self.operation_locks.setdefault(key,asyncio.Lock()):
                if time.monotonic()>=self.operation_checked.get(key,0):
                    stamp=time.monotonic()
                    while self.refresh_calls and self.refresh_calls[0]<stamp-60:self.refresh_calls.popleft()
                    if len(self.refresh_calls)>=60:
                        warning='RATE_LIMITED'
                    else:
                        self.refresh_calls.append(stamp)
                        try:
                            payload=await self.client.list_card_operations(card_id,limit=100)
                            items=_list_data(payload)
                            if len(items)>100 or any(not isinstance(row,dict) or row.get('card_id')!=card_id for row in items):raise ValueError('Operation card mismatch')
                            self.ledger.begin('card_operations_snapshot',uid,card_id)
                            try:
                                for row in items:_store_card_operation(self.ledger,self.environment,row,notify=False)
                                self.ledger.commit()
                            except Exception:self.ledger.rollback();raise
                        except Exception as error:warning=getattr(error,'name','CARD_OPERATIONS_UNAVAILABLE')
                    self.operation_checked[key]=time.monotonic()+30
        rows={row['operation_id']:dict(row) for row in self.ledger.db.execute('SELECT operation_id,operation_type,status,previous_status,asset,amount,fee,merchant,original_amount,original_currency,decline_message,provider_created_at FROM aura_card_operations WHERE card_id=? AND user_id=? AND environment=?',(card_id,uid,self.environment))}
        for entity in self.ledger.db.execute("SELECT remote_id,status,request_body,created_at FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND user_id=? AND entity_type='card_recharge' AND remote_id IS NOT NULL AND status IN ('requested','sent','completed','failed')",(self.environment,uid)):
            stored=json.loads(entity['request_body']);result=stored.get('result')
            if stored.get('card_id')!=card_id or not isinstance(result,dict) or entity['remote_id'] in rows:continue
            rows[entity['remote_id']]={'operation_id':entity['remote_id'],'operation_type':'topup','status':'pending' if entity['status'] in {'requested','sent'} else entity['status'],
                'asset':'USDT','amount':str(_decimal(result['recharge_amount'],allow_zero=True)),'fee':None,'merchant':None,'decline_message':None,
                'provider_created_at':datetime.fromtimestamp(entity['created_at'],timezone.utc).isoformat()}
        items=sorted(rows.values(),key=lambda row:row['provider_created_at'] or '',reverse=True)[:200]
        return {'data':items,'refresh_warning':warning}

    async def quote(self, uid, body):
        if not isinstance(body, dict) or set(body) - {'operation','plan_id','card_id','amount','shipping_address'}:
            raise ValueError('Invalid card quote')
        recent = self.ledger.db.execute('SELECT COUNT(*) FROM wallet_card_quotes WHERE environment=? AND expires_at>? AND user_id=?',(self.environment,time.time()+60,uid)).fetchone()[0]
        if recent >= 20:
            raise self.client.error_cls('rate_limited','Слишком много расчётов. Повторите позже',429,'30')
        operation = body.get('operation')
        raw = await self.provider_fees()
        if raw.get('currency') != 'USDT':
            raise ValueError('Invalid fees')
        card_id, amount = None, None
        if operation == 'issue':
            plan_id, plan = resolve_card_plan(body.get('plan_id'), '')
            if not card_issue_enabled(self.ledger, plan_id):
                raise self.client.error_cls('card_kind_unavailable', 'Выпуск по этому тарифу отключён', 412)
            value = raw.get('open_' + plan['kind'] + '_card_fee')
            if value is None or value == '':
                raise self.client.error_cls('card_kind_unavailable', 'Выпуск недоступен', 412)
            provider_fee = _decimal(value, allow_zero=True)
            service_fee, tariff = calculate(self.ledger, plan_id, provider_fee, operation='issue')
            total = provider_fee + service_fee
            reserve = total
        elif operation == 'recharge':
            row = self.owned(uid, str(body.get('card_id') or ''))
            if row['status'] != 'opened' or row['frozen']:
                raise self.client.error_cls('card_not_active', 'Карта недоступна для пополнения', 409)
            card_id = row['card_id']
            plan_id, plan = resolve_card_plan(row['plan_id'], row['kind'])
            amount = _decimal(body.get('amount'))
            if amount < _decimal(raw['minimum_recharge_amount']):
                raise self.client.error_cls('amount_out_of_range', 'Сумма меньше минимума пополнения', 400)
            field = 'physical_recharge_fee_pct' if plan['kind'] == 'physical' else 'recharge_fee_pct'
            with localcontext() as ctx:
                ctx.prec = 80
                provider_fee = amount * _decimal(raw[field], allow_zero=True) / Decimal(100)
                service_fee, tariff = calculate(self.ledger, plan_id, amount, operation='recharge')
                total = amount + provider_fee + service_fee
                reserve = total + Decimal('0.01')
        else:
            raise ValueError('Invalid card operation')
        if tariff['version_id'] is None:
            raise self.client.error_cls('TARIFF_NOT_CONFIGURED', 'Тариф карты ещё не настроен. Обратитесь в поддержку', 503)
        available, _ = self.ledger.balance(uid, 'USDT')
        backed_row=self.ledger.db.execute("SELECT available FROM wallet_provider_positions WHERE provider='aura' AND environment=? AND user_id=? AND asset='USDT'",(self.environment,uid)).fetchone()
        backed=Decimal(backed_row['available']) if backed_row else Decimal(0)
        spendable=min(available,backed)
        retry_key = None
        for pending in self.ledger.db.execute(
            "SELECT idempotency_key,request_body FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND user_id=? AND entity_type=? AND status IN ('reserved','needs_reconciliation') AND remote_id IS NULL",
            (self.environment,uid,'card_request' if operation == 'issue' else 'card_recharge'),
        ):
            old = json.loads(pending['request_body'])
            if operation == 'issue' and old.get('plan_id') == plan_id:
                if old.get('shipping_address') != body.get('shipping_address'):
                    raise self.client.error_cls('CARD_OPERATION_PENDING', 'Предыдущий выпуск ещё не подтверждён. Используйте прежние данные доставки', 409)
                retry_key = pending['idempotency_key']; total = reserve = Decimal(old['fee'])
                service_fee = Decimal(old.get('service_fee','0')); provider_fee = total-service_fee
            elif operation == 'recharge' and old.get('card_id') == card_id and old.get('request',{}).get('amount') == str(amount):
                retry_key = pending['idempotency_key']; reserve = Decimal(old['reserve_amount']); total = reserve-Decimal('0.01')
                service_fee=Decimal(old.get('service_fee','0')); provider_fee=total-amount-service_fee
        quote = {'quote_id': uuid.uuid4().hex, 'operation': operation, 'plan_id': plan_id,
                 'card_id': card_id, 'amount': str(amount) if amount is not None else None,
                 'provider_fee': str(provider_fee), 'service_fee': str(service_fee),
                 'total': str(total), 'reserve': str(reserve), 'currency': 'USDT',
                 'tariff_version': tariff['version_id'], 'retry_key': retry_key, 'can_afford': retry_key is not None or spendable >= reserve,
                 'spendable': str(spendable), 'funding_error': 'AURA_FUNDS_UNAVAILABLE' if retry_key is None and available >= reserve and backed < reserve else None,
                 'expires_at': time.time() + 120, 'estimated': operation == 'recharge'}
        self.ledger.db.execute('INSERT INTO wallet_card_quotes(id,user_id,environment,operation,body,expires_at) VALUES (?,?,?,?,?,?)',
            (quote['quote_id'],uid,self.environment,operation,json.dumps(quote),quote['expires_at']))
        return quote

    def guard(self, uid, body, operation, key):
        row = self.ledger.db.execute(
            'SELECT * FROM wallet_card_quotes WHERE id=? AND user_id=? AND environment=? AND operation=?',
            (body.get('quote_id'),uid,self.environment,operation),
        ).fetchone()
        if not row:
            raise self.client.error_cls('quote_expired', 'Повторите расчёт стоимости', 400)
        quote = json.loads(row['body'])
        if row['used_key'] and row['used_key'] != key:
            raise self.client.error_cls('quote_expired', 'Этот расчёт уже используется другой операцией', 409)
        existing = self.ledger.db.execute(
            "SELECT user_id FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND entity_type=? AND local_id=?",
            (self.environment,'card_request' if operation == 'issue' else 'card_recharge',key),
        ).fetchone()
        if existing and existing['user_id'] != uid:
            raise self.client.error_cls('not_found', 'Операция не найдена', 404)
        if not existing and min(row['expires_at'], quote['expires_at']) < time.time():
            raise self.client.error_cls('quote_expired', 'Повторите расчёт стоимости', 400)
        if operation == 'issue' and body.get('plan_id') != quote['plan_id']:
            raise ValueError('Card plan changed')
        if operation == 'recharge' and (body.get('card_id') != quote['card_id'] or _decimal(body.get('amount')) != _decimal(quote['amount'])):
            raise ValueError('Recharge changed')
        self.ledger.begin('card_quote_bind', uid, key)
        try:
            changed = self.ledger.db.execute('UPDATE wallet_card_quotes SET used_key=? WHERE id=? AND (used_key IS NULL OR used_key=?)',(key,row['id'],key)).rowcount
            if not changed: raise self.client.error_cls('quote_expired','Расчёт уже использован',409)
            self.ledger.commit()
        except Exception:
            self.ledger.rollback(); raise
        def verify(total, tariff_version):
            target = quote['total'] if operation == 'issue' else quote['reserve']
            if total != Decimal(target) or tariff_version != quote['tariff_version']:
                raise self.client.error_cls('card_fee_changed', 'Тариф изменился. Обновите расчёт', 412)
        return verify

    async def route(self, request, action, uid, client_ref):
        if action not in {'card-quote','aura-card-fees','aura-cards','aura-card-recharge','aura-card-operations'}:
            return None
        if action == 'aura-card-operations' and request.method == 'GET':
            if set(request.query)!={'card_id'}:raise ValueError('Only card_id accepted')
            return web.json_response(await self.operations(uid,request.query['card_id']),headers={'Cache-Control':'no-store'})
        if not self.enabled:
            if action == 'aura-cards' and request.method == 'GET':
                return web.json_response({'data':self.cards(uid)},headers={'Cache-Control':'no-store'})
            raise self.client.error_cls('NOT_CONFIGURED','Карты не подключены',503)
        if action == 'card-quote' and request.method == 'POST':
            return web.json_response(await self.quote(uid, await request.json()), headers={'Cache-Control':'no-store'})
        if action == 'aura-card-fees' and request.method == 'GET':
            return web.json_response(await self.fees(), headers={'Cache-Control':'no-store'})
        if action == 'aura-cards' and request.method == 'GET':
            warning = None
            try:
                await self.refresh(uid)
            except Exception as error:
                warning = getattr(error, 'name', 'CARD_REFRESH_UNAVAILABLE')
            return web.json_response({'data':self.cards(uid),'refresh_warning':warning},headers={'Cache-Control':'no-store'})
        if action in {'aura-cards','aura-card-recharge'} and request.method == 'POST':
            body = await request.json()
            if not isinstance(body, dict) or 'quote_id' not in body:
                return None
            if not await self.client.product_enabled('cards'):
                raise self.client.error_cls('cards_not_enabled', 'Карты недоступны', 403)
            key = request.headers.get('Idempotency-Key','')
            if not 1 <= len(key) <= 200:
                raise self.client.error_cls('idempotency_key_required', 'Не указан ключ операции', 400)
            if action == 'aura-cards':
                if set(body) - {'quote_id','kind','plan_id','shipping_address'}:
                    raise ValueError('Invalid issue body')
                guard = self.guard(uid,body,'issue',key)
                result = await self.service.create_card_request(uid,client_ref,kind=body.get('kind','virtual'),
                    shipping_address=body.get('shipping_address'),plan_id=body.get('plan_id'),idempotency_key=key,price_guard=guard)
            else:
                if set(body) != {'quote_id','card_id','amount'}:
                    raise ValueError('Invalid recharge body')
                guard = self.guard(uid,body,'recharge',key)
                result = await self.service.recharge_card_request(uid,body['card_id'],amount=body['amount'],idempotency_key=key,price_guard=guard)
            entity = self.ledger.db.execute(
                "SELECT status FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND user_id=? AND entity_type=? AND local_id=?",
                (self.environment,uid,'card_request' if action == 'aura-cards' else 'card_recharge',key),
            ).fetchone()
            if entity and entity['status'] == 'needs_reconciliation':
                raise self.client.error_cls('RECONCILIATION_REQUIRED','Итоговая сумма уточняется. Не создавайте повторную операцию',503)
            self.checked.pop(uid,None)
            return web.json_response(result,headers={'Cache-Control':'no-store'})
        return None

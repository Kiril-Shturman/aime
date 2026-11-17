"""Install the order lifecycle on the current backend without replacing other flows."""
import ast
import sys
from pathlib import Path


def patch(source):
    if 'from wallet_fixedfloat_orders import Orders' in source:return source
    changes=[
        ('import asyncio\n','import asyncio\nfrom wallet_fixedfloat_orders import Orders\n'),
        ("'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET',", "'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET', 'WPAY_FIXEDFLOAT_ORDERS_ENABLED',"),
        ("    app['wpay_exchange'] = exchange\n", "    app['wpay_exchange'] = exchange\n    exchange_orders = Orders(ledger, exchange, enabled=os.environ.get('WPAY_FIXEDFLOAT_ORDERS_ENABLED','0') == '1')\n    app['wpay_exchange_orders'] = exchange_orders\n"),
        ('            exchange_response = await exchange_route(request, action, uid, exchange)', '            order_response = await exchange_orders.route(request, action, uid)\n            if order_response is not None:\n                return order_response\n            exchange_response = await exchange_route(request, action, uid, exchange)'),
        ('    async def cleanup(_):\n', "    async def cleanup(_):\n        order_task = app.get('wpay_order_task')\n        if order_task:\n            order_task.cancel(); await asyncio.gather(order_task, return_exceptions=True)\n"),
        ('    async def startup(_):\n', "    async def startup(_):\n        if exchange_orders.enabled:\n            app['wpay_order_task'] = asyncio.create_task(exchange_orders.run())\n"),
    ]
    for before,after in changes:
        if source.count(before)!=1:raise ValueError('Order integration anchor missing: '+before[:60])
        source=source.replace(before,after,1)
    ast.parse(source);return source


if __name__=='__main__':
    p=Path(sys.argv[1])/'wallet_backend.py';before=p.read_text();after=patch(before)
    if before!=after:
        mode=p.stat().st_mode & 0o777;p.unlink();p.write_text(after);p.chmod(mode)
    print('FixedFloat order lifecycle installed')

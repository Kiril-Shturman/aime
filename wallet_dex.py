"""Read-only PancakeSwap v2 quotes for the BSC native asset."""
import re
from decimal import Decimal

from aiohttp import ClientError

from wallet_chain import ERC20

ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
WBNB = "bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
RPC_URLS = ("https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org")
PAIR = {"from_asset": "BNB", "from_network": "BSC", "to_asset": "USDT", "to_network": "BSC"}


async def quote_bnb(chain, amount):
    if not isinstance(amount, str) or not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,18})?", amount):
        raise ValueError("Укажите сумму BNB с точностью до 18 знаков")
    value = int(Decimal(amount).scaleb(18))
    if not value:
        raise ValueError("Сумма BNB должна быть больше нуля")
    token, decimals = ERC20[("BSC", "USDT")]
    data = "0xd06ca61f" + f"{value:064x}{64:064x}{2:064x}{WBNB:0>64}{token[2:]:0>64}"
    for url in RPC_URLS:
        try:
            if await chain.rpc(url, "eth_chainId", []) != "0x38":
                continue
            raw = await chain.rpc(url, "eth_call", [{"to": ROUTER, "data": data}, "latest"])
            if not isinstance(raw, str) or not re.fullmatch(r"0x[0-9a-fA-F]{256}", raw):
                continue
            offset, length, sent, payout = (int(raw[i:i+64], 16) for i in range(2, 258, 64))
            if (offset, length, sent) != (32, 2, value) or payout <= 0:
                continue
            whole, fraction = divmod(payout, 10**decimals)
            return {"provider": "pancakeswap_v2", "to_amount": f"{whole}.{fraction:0{decimals}d}".rstrip("0").rstrip(".")}
        except (ClientError, TimeoutError, ValueError):
            continue
    return None

"""Read-only quotes for native assets exchanged for same-network USDT."""
import os
import re
from urllib.parse import urlencode
from decimal import Decimal

from aiohttp import ClientError

from wallet_chain import ERC20, SOL_USDT, TON_USDT
from wallet_exchange_routes import NATIVE_NETWORK

ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
WBNB = "bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
RPC_URLS = ("https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org")
PAIR = {"from_asset": "BNB", "from_network": "BSC", "to_asset": "USDT", "to_network": "BSC"}


UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
WETH = "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
WSOL = "So11111111111111111111111111111111111111112"
TON_NATIVE = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"


def supports_pair(pair):
    network = NATIVE_NETWORK.get(pair.get("from_asset"))
    return network is not None and pair.get("from_network") == pair.get("to_network") == network and pair.get("to_asset") == "USDT"


def atomic_amount(amount, asset, decimals):
    if not isinstance(amount, str) or not re.fullmatch(rf"[0-9]{{1,8}}(?:\.[0-9]{{1,{decimals}}})?", amount):
        raise ValueError(f"Укажите сумму {asset} с точностью до {decimals} знаков")
    value = int(Decimal(amount).scaleb(decimals))
    if not value:
        raise ValueError(f"Сумма {asset} должна быть больше нуля")
    return value


def format_quote(provider, payout, decimals):
    whole, fraction = divmod(payout, 10**decimals)
    return {"provider": provider, "to_amount": f"{whole}.{fraction:0{decimals}d}".rstrip("0").rstrip(".")}


async def quote_evm(chain, amount, asset, network, chain_id, router, wrapped, urls, provider):
    value = atomic_amount(amount, asset, 18)
    token, decimals = ERC20[(network, "USDT")]
    data = "0xd06ca61f" + f"{value:064x}{64:064x}{2:064x}{wrapped:0>64}{token[2:]:0>64}"
    for url in urls:
        try:
            if await chain.rpc(url, "eth_chainId", []) != chain_id:
                continue
            raw = await chain.rpc(url, "eth_call", [{"to": router, "data": data}, "latest"])
            if not isinstance(raw, str) or not re.fullmatch(r"0x[0-9a-fA-F]{256}", raw):
                continue
            offset, length, sent, payout = (int(raw[i:i+64], 16) for i in range(2, 258, 64))
            if (offset, length, sent) != (32, 2, value) or payout <= 0:
                continue
            return format_quote(provider, payout, decimals)
        except (ClientError, TimeoutError, ValueError):
            continue
    return None


async def quote_bnb(chain, amount):
    return await quote_evm(chain, amount, "BNB", "BSC", "0x38", ROUTER, WBNB, RPC_URLS, "pancakeswap_v2")


async def quote_native(chain, asset, amount):
    if asset == "BNB":
        return await quote_bnb(chain, amount)
    if asset == "ETH":
        return await quote_evm(
            chain, amount, "ETH", "ETH", "0x1", UNISWAP_ROUTER, WETH,
            ("https://ethereum-rpc.publicnode.com",), "uniswap_v2",
        )
    if asset not in {"SOL", "GRAM"}:
        raise ValueError("Неподдерживаемая монета DEX")
    value = atomic_amount(amount, asset, 9)
    try:
        if asset == "SOL":
            key = os.environ.get("WPAY_JUPITER_API_KEY")
            query = urlencode({"inputMint": WSOL, "outputMint": SOL_USDT, "amount": value})
            result = await chain.request(
                "https://api.jup.ag/swap/v2/order?" + query,
                headers={"x-api-key": key} if key else None,
            )
            if (result.get("inputMint"), result.get("outputMint"), str(result.get("inAmount"))) != (WSOL, SOL_USDT, str(value)):
                return None
            payout, provider = result.get("outAmount"), "jupiter"
        else:
            query = urlencode({
                "offer_address": TON_NATIVE, "ask_address": TON_USDT,
                "units": value, "slippage_tolerance": "0.01", "dex_v2": "true",
            })
            result = await chain.request("https://api.ston.fi/v1/swap/simulate?" + query, {})
            if (result.get("offer_address"), result.get("ask_address"), str(result.get("offer_units"))) != (TON_NATIVE, TON_USDT, str(value)):
                return None
            payout, provider = result.get("ask_units"), "ston_fi"
        if not isinstance(payout, str) or not re.fullmatch(r"[0-9]{1,24}", payout) or int(payout) == 0:
            return None
        return format_quote(provider, int(payout), 6)
    except (ClientError, TimeoutError, ValueError):
        return None


def swap_calldata(recipient, minimum, deadline):
    """Encode native BNB → USDT with a fixed router path and a bounded payout."""
    if not isinstance(recipient, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", recipient) or int(recipient, 16) == 0:
        raise ValueError("Invalid payout recipient")
    if type(minimum) is not int or type(deadline) is not int or not all(0 < value < 2**256 for value in (minimum, deadline)):
        raise ValueError("Invalid swap constraints")
    token, _ = ERC20[("BSC", "USDT")]
    return "0x7ff36ab5" + (
        f"{minimum:064x}{128:064x}{recipient[2:].lower():0>64}{deadline:064x}"
        f"{2:064x}{WBNB:0>64}{token[2:]:0>64}"
    )

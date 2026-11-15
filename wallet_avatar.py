"""Serve only the authenticated user's Telegram profile photo, without leaking bot URLs."""
from collections import OrderedDict
import hashlib
import re
import socket
import time

from aiohttp import ClientSession, ClientTimeout, TCPConnector

MAX_BYTES = 2 * 1024 * 1024
_cache = OrderedDict()


class AvatarNotFound(ValueError):
    pass


async def load_avatar(bot_token, telegram_id):
    if not bot_token or not isinstance(telegram_id, int) or telegram_id <= 0:
        raise AvatarNotFound('No Telegram avatar')
    key = (hashlib.sha256(bot_token.encode()).hexdigest(), telegram_id)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < 300:
        _cache.move_to_end(key)
        return cached[1], cached[2]
    try:
        async with ClientSession(timeout=ClientTimeout(total=12, connect=3), connector=TCPConnector(family=socket.AF_INET)) as session:
            async def api(method, params):
                async with session.post('https://api.telegram.org/bot' + bot_token + '/' + method, json=params) as response:
                    if response.status != 200:
                        raise ValueError('Telegram unavailable')
                    body = await response.json()
                    if not isinstance(body, dict) or body.get('ok') is not True:
                        raise ValueError('Telegram unavailable')
                    return body['result']
            photos = await api('getUserProfilePhotos', {'user_id': telegram_id, 'limit': 1})
            if not photos.get('photos'):
                raise AvatarNotFound('No Telegram avatar')
            picture = max(photos['photos'][0], key=lambda photo: int(photo.get('width', 0)))
            file = await api('getFile', {'file_id': picture['file_id']})
            path = str(file.get('file_path') or '')
            if not re.fullmatch(r'[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)', path) or path.startswith('/') or '..' in path:
                raise ValueError('Invalid Telegram avatar file')
            async with session.get('https://api.telegram.org/file/bot' + bot_token + '/' + path, allow_redirects=False) as response:
                if response.status != 200 or (response.content_length and response.content_length > MAX_BYTES):
                    raise ValueError('Avatar unavailable')
                data = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise ValueError('Avatar too large')
                image = bytes(data)
                if image.startswith(b'\xff\xd8\xff'):
                    kind = 'image/jpeg'
                elif image.startswith(b'\x89PNG\r\n\x1a\n'):
                    kind = 'image/png'
                elif image.startswith(b'RIFF') and image[8:12] == b'WEBP':
                    kind = 'image/webp'
                else:
                    raise ValueError('Invalid avatar image')
    except AvatarNotFound:
        raise
    except Exception:
        # Network exceptions can include the bot-token URL; never surface their text.
        raise ValueError('Avatar unavailable') from None
    _cache[key] = (time.monotonic(), image, kind)
    _cache.move_to_end(key)
    while len(_cache) > 32:
        _cache.popitem(last=False)
    return image, kind

import unittest
from unittest.mock import AsyncMock, patch
import test_wallet_backend as fixtures
from wallet_avatar import AvatarNotFound


class AvatarRoutesTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.WalletRoutesTests.asyncSetUp
    asyncTearDown = fixtures.WalletRoutesTests.asyncTearDown

    async def test_avatar_requires_signed_identity(self):
        with patch('wallet_backend.load_avatar', new_callable=AsyncMock) as load:
            response = await self.client.get('/api/wallet/profile-avatar')
            self.assertEqual(response.status, 401)
            load.assert_not_called()

    async def test_own_photo_binary_private_and_no_identity_override(self):
        photo = b'\x89PNG\r\n\x1a\nphoto'
        with patch('wallet_backend.load_avatar', new_callable=AsyncMock, return_value=(photo, 'image/png')) as load:
            headers = {'X-Telegram-Init-Data': fixtures.init_data(123)}
            response = await self.client.get('/api/wallet/profile-avatar', headers=headers)
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), photo)
            self.assertEqual(response.content_type, 'image/png')
            self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
            load.assert_awaited_once_with(fixtures.BOT, 123)
            response = await self.client.get('/api/wallet/profile-avatar?user_id=456', headers=headers)
            self.assertEqual(response.status, 400)
            self.assertEqual(load.await_count, 1)

    async def test_no_photo_and_sanitized_upstream_error(self):
        headers = {'X-Telegram-Init-Data': fixtures.init_data(123)}
        for error, status in [(AvatarNotFound('missing'), 404), (ValueError('secret-token-url'), 502)]:
            with patch('wallet_backend.load_avatar', new_callable=AsyncMock, side_effect=error):
                response = await self.client.get('/api/wallet/profile-avatar', headers=headers)
                self.assertEqual(response.status, status)
                self.assertNotIn('secret-token-url', await response.text())

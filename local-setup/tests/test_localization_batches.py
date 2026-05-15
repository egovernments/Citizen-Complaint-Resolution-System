#!/usr/bin/env python3
import os
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "jupyter", "dataloader"))

from unified_loader import APIUploader


class FakeResponse:
    def __init__(self, status_code=200, text='{}'):
        self.status_code = status_code
        self.text = text
        self.headers = {}

    def raise_for_status(self):
        return None

    def json(self):
        return {}


class LocalizationBatchTests(unittest.TestCase):
    def _build_uploader(self):
        uploader = APIUploader.__new__(APIUploader)
        uploader.localization_url = 'http://example.local/localization'
        uploader.auth_token = 'token'
        uploader.user_info = {'id': 1, 'tenantId': 'pg'}
        return uploader

    def test_sanitize_batch_dedupes_by_code_only_and_preserves_first(self):
        uploader = self._build_uploader()

        batch = [
            {'code': 'CODE_1', 'message': 'First', 'module': 'module-a', 'locale': 'en_IN'},
            {'code': 'CODE_1', 'message': 'Second', 'module': 'module-b', 'locale': 'en_IN'},
            {'code': 'CODE_2', 'message': 'Third', 'module': 'module-c', 'locale': 'en_IN'},
        ]

        sanitized = uploader._sanitize_localization_batch(batch)

        self.assertEqual(
            sanitized['messages'],
            [
                {'code': 'CODE_1', 'message': 'First', 'module': 'module-a', 'locale': 'en_IN'},
                {'code': 'CODE_2', 'message': 'Third', 'module': 'module-c', 'locale': 'en_IN'},
            ]
        )
        self.assertEqual(sanitized['skipped_duplicates'], 1)

    def test_create_localization_messages_sends_sanitized_batches(self):
        uploader = self._build_uploader()
        captured_payloads = []

        def fake_request(url, *, json=None, headers=None, timeout=None, **kwargs):
            captured_payloads.append({
                'url': url,
                'payload': json,
                'timeout': timeout,
            })
            return FakeResponse()

        localizations = [
            {'code': 'CODE_1', 'message': 'First', 'module': 'module-a', 'locale': 'en_IN'},
            {'code': 'CODE_1', 'message': 'Duplicate later row', 'module': 'module-b', 'locale': 'en_IN'},
            {'code': 'CODE_2', 'message': 'Second code', 'module': 'module-c', 'locale': 'en_IN'},
        ]

        with patch.object(uploader, '_request_with_retry', side_effect=fake_request):
            with patch('unified_loader.time.sleep', return_value=None):
                result = uploader.create_localization_messages(localizations, tenant='pg')

        self.assertEqual(result['upserted'], 2)
        self.assertEqual(result['created'], 2)
        self.assertEqual(result['exists'], 0)
        self.assertEqual(result['failed'], 0)
        self.assertEqual(len(captured_payloads), 1)
        self.assertEqual(captured_payloads[0]['url'], 'http://example.local/localization/messages/v1/_upsert')
        self.assertEqual(captured_payloads[0]['timeout'], uploader.LOCALIZATION_UPSERT_TIMEOUT)
        self.assertEqual(
            captured_payloads[0]['payload']['messages'],
            [
                {'code': 'CODE_1', 'message': 'First', 'module': 'module-a', 'locale': 'en_IN'},
                {'code': 'CODE_2', 'message': 'Second code', 'module': 'module-c', 'locale': 'en_IN'},
            ]
        )


if __name__ == '__main__':
    unittest.main()

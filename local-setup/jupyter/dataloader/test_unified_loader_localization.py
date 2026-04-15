import os
import sys
from tempfile import NamedTemporaryFile

import pandas as pd


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from unified_loader import UnifiedExcelReader


def _write_localization_sheet(rows, sheet_name="Localization"):
    temp = NamedTemporaryFile(suffix=".xlsx", delete=False)
    temp.close()

    df = pd.DataFrame(rows)
    with pd.ExcelWriter(temp.name, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)

    return temp.name


def test_read_localization_uses_sheet_locale_and_module():
    excel_path = _write_localization_sheet([
        {
            "Code": "ACTION_TEST_UC",
            "Message": "m-Collect",
            "Module": "rainmaker-common",
            "Locale": "ta_IN",
        },
        {
            "Code": "BILLINGSERVICE_BUSINESSSERVICE_OM_WATER_CONNECTION/DISCONNECTION_FEES",
            "Message": "Water connection/ disconnection fees",
            "Module": "rainmaker-common",
            "Locale": "ta_IN",
        },
    ])

    try:
        records = UnifiedExcelReader(excel_path).read_localization()
    finally:
        os.unlink(excel_path)

    assert records == [
        {
            "code": "ACTION_TEST_UC",
            "message": "m-Collect",
            "module": "rainmaker-common",
            "locale": "ta_IN",
        },
        {
            "code": "BILLINGSERVICE_BUSINESSSERVICE_OM_WATER_CONNECTION/DISCONNECTION_FEES",
            "message": "Water connection/ disconnection fees",
            "module": "rainmaker-common",
            "locale": "ta_IN",
        },
    ]


def test_read_localization_prefers_translation_column():
    excel_path = _write_localization_sheet([
        {
            "Code": "ACTION_TEST_UC",
            "Message": "mCollect",
            "Translation": "எம்-கலெக்ட்",
            "Module": "rainmaker-common",
            "Locale": "ta_IN",
        },
    ], sheet_name="localization")

    try:
        records = UnifiedExcelReader(excel_path).read_localization()
    finally:
        os.unlink(excel_path)

    assert records == [
        {
            "code": "ACTION_TEST_UC",
            "message": "எம்-கலெக்ட்",
            "module": "rainmaker-common",
            "locale": "ta_IN",
        }
    ]


def test_read_localization_falls_back_for_legacy_sheets():
    excel_path = _write_localization_sheet([
        {
            "Code": "TENANT_TENANTS_PG",
            "Message": "Demo",
        },
        {
            "Code": "SERVICEDFS.WATER",
            "Message": "Water",
        },
    ])

    try:
        records = UnifiedExcelReader(excel_path).read_localization()
    finally:
        os.unlink(excel_path)

    assert records == [
        {
            "code": "TENANT_TENANTS_PG",
            "message": "Demo",
            "module": "rainmaker-common",
            "locale": "en_IN",
        },
        {
            "code": "SERVICEDFS.WATER",
            "message": "Water",
            "module": "rainmaker-pgr",
            "locale": "en_IN",
        },
    ]

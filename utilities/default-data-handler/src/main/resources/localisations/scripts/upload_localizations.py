import pandas as pd
import requests
import json
import sys
import math
from datetime import datetime

def upload_localizations(excel_file, host, tenant_id, auth_token, batch_size=100):
    # Load all sheets
    xls = pd.ExcelFile(excel_file)
    print(f"Found sheets: {xls.sheet_names}")

    for sheet_name in xls.sheet_names:
        print(f"\nProcessing sheet: {sheet_name}")
        df = pd.read_excel(xls, sheet_name=sheet_name)

        # Validate required columns
        required_cols = ["code", "message", "module", "locale"]
        for col in required_cols:
            if col not in df.columns:
                raise ValueError(f"Missing required column in '{sheet_name}': '{col}'")

        # Build all message entries
        messages = [
            {
                "code": str(row["code"]).strip(),
                "message": str(row["message"]).strip(),
                "module": str(row["module"]).strip(),
                "locale": str(row["locale"]).strip()
            }
            for _, row in df.iterrows()
        ]

        total_batches = math.ceil(len(messages) / batch_size)
        print(f"Total messages: {len(messages)}, uploading in {total_batches} batch(es).")

        # Process in batches
        for i in range(0, len(messages), batch_size):
            batch = messages[i:i+batch_size]
            payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "ver": ".01",
                    "ts": "",
                    "action": "_create",
                    "did": "1",
                    "key": "",
                    "msgId": f"{datetime.now().strftime('%Y%m%d%H%M%S')}|{batch[0]['locale']}" if batch else "",
                    "authToken": auth_token
                },
                "tenantId": tenant_id,
                "module": batch[0]["module"] if batch else "",
                "locale": batch[0]["locale"] if batch else "",
                "messages": batch
            }

            url = f"{host}/localization/messages/v1/_upsert"
            headers = {"Content-Type": "application/json"}

            print(f"Uploading batch {i//batch_size + 1}/{total_batches} for sheet '{sheet_name}'...")
            response = requests.post(url, headers=headers, data=json.dumps(payload))

            if response.status_code == 200:
                print(f"✅ Batch {i//batch_size + 1} uploaded successfully.")
            else:
                print(f"❌ Failed batch {i//batch_size + 1}. Status: {response.status_code}")
                print(response.text)
                break  # Optional: stop on first failure


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python upload_localizations.py <excel_file> <host> <tenant_id> <auth_token> [batch_size]")
        sys.exit(1)

    excel_file = sys.argv[1]
    host = sys.argv[2]
    tenant_id = sys.argv[3]
    auth_token = sys.argv[4]
    batch_size = int(sys.argv[5]) if len(sys.argv) > 5 else 100

    upload_localizations(excel_file, host, tenant_id, auth_token, batch_size)


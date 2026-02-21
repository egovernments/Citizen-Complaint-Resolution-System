#!/usr/bin/env bash
# ------------------------------------------------------------------
# Seed script: Creates a NOTIF_TEMPLATE_MAP config entry
# for COMPLAINTS.WORKFLOW.APPLY event in the config-service.
#
# Usage:
#   CONFIG_HOST=http://localhost:9000 bash seed-notif-template-map.sh
# ------------------------------------------------------------------

CONFIG_HOST="${CONFIG_HOST:-http://localhost:9000}"

echo "Seeding NOTIF_TEMPLATE_MAP entry in ${CONFIG_HOST} ..."

curl -s -w "\nHTTP %{http_code}\n" \
  -X POST "${CONFIG_HOST}/config-service/config/v1/entry/_create" \
  -H "Content-Type: application/json" \
  -d '{
  "RequestInfo": {
    "apiId": "config-seed",
    "ver": "1.0",
    "ts": 0,
    "action": "_create",
    "did": "1",
    "key": "",
    "msgId": "seed-001",
    "requesterId": "system",
    "authToken": ""
  },
  "entry": {
    "configCode": "NOTIF_TEMPLATE_MAP",
    "module": "Complaints",
    "eventType": "COMPLAINTS.WORKFLOW.APPLY",
    "channel": "WHATSAPP",
    "tenantId": "*",
    "locale": "*",
    "enabled": true,
    "value": {
      "templateKey": "complaints-workflow-apply-42yz",
      "templateVersion": "v1",
      "twilioContentSid": "HX158f8edc7079e2c2b76d9c8f68e87791",
      "templateBody": "Hi {{citizenName}}, your complaint {{complaintNo}} for {{serviceName}} is now {{status}}. Assigned to {{departmentName}}.",
      "requiredVars": ["complaintNo", "status", "serviceName", "citizenName", "departmentName"],
      "optionalVars": ["mobileNumber"],
      "paramOrder": ["serviceName", "complaintNo", "status", "citizenName", "departmentName"]
    }
  }
}'

#!/usr/bin/env python3
# Generate SQL to create the RAINMAKER-PGR.NotificationProviderTemplate MDMS master
# and seed the verified Twilio WhatsApp ContentSid mapping (CITIZEN, EN + HI).
import json

TENANT = "ke"
CODE = "RAINMAKER-PGR.NotificationProviderTemplate"

SCHEMA = {
    "type": "object", "title": "NotificationProviderTemplate",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "x-unique": ["provider", "channel", "audience", "action", "toState", "locale"],
    "properties": {
        "provider": {"type": "string"}, "channel": {"type": "string"},
        "audience": {"type": "string"}, "action": {"type": "string"},
        "toState": {"type": "string"}, "locale": {"type": "string"},
        "templateId": {"type": "string"}, "templateName": {"type": "string"},
        "variables": {"type": "array", "items": {"type": "string"}},
        "approvalStatus": {"type": "string"}, "active": {"type": "boolean"},
    },
    "required": ["provider", "channel", "audience", "action", "toState", "locale", "templateId", "variables"],
}

# (action, toState, en_sid, hi_sid, variables, en_name)
M = [
 ("APPLY","PENDINGFORASSIGNMENT","HX67fae4a61c4f50db8a11ebac21c50a79","HX0f48a25c5dff81a1c5ee47a2cd122b36",
  ["complaint_type","id","date"],"complaints_apply_pendingforassignment_message_new"),
 ("ASSIGN","PENDINGATLME","HX9d0ab22fb14080bdfd3d4cb43d9bd6f7","HX0d5538241557b1b56a910b8a48fc6b48",
  ["complaint_type","id","date","emp_name","emp_designation","emp_department"],"complaints_citizen_assign_pendingatlme_message_new"),
 ("RESOLVE","RESOLVED","HXe6f34b83cc6e7179c0ede06472dd81fb","HX7676f0a4eb2f9da5b2f207b8a9202710",
  ["complaint_type","id","date","emp_name"],"complaints_citizen_resolve_resolved_message_new"),
 ("REJECT","REJECTED","HXea318abc741dd5c09555617a4ecad490","HX38efc29e9d643f7e8717cbf11015c4aa",
  ["complaint_type","id","date","additional_comments"],"complaints_citizen_reject_rejected_message_new"),
 ("REOPEN","PENDINGFORASSIGNMENT","HXc7f239a0b267bbe208898c32bbd6034a","HX04e739b1b1e115e4a54f062f044738ac",
  ["complaint_type","id","date"],"complaints_citizen_reopen_pendingforassignment_sms_message_new"),
 ("REASSIGN","PENDINGFORREASSIGNMENT","HX7dc390ab0a8cd7cd3bde32768278dbd7","HX276d74eefa5ae90d2e0716a4cdc3c7ca",
  ["complaint_type","id","date","emp_name","emp_designation","emp_department"],"complaints_citizen_reassign_pendingatlme_message_new"),
 ("RATE","CLOSEDAFTERRESOLUTION","HXa0ad0ef3f58903809464f1707a9347a8","HX84ff2205a1ea72eaa1326fd93bb37368",
  ["complaint_type","id","date"],"complaints_rate_english_message_new"),
]

def sq(s):  # SQL single-quote escape
    return s.replace("'", "''")

rows = []
for action, to_state, en_sid, hi_sid, variables, en_name in M:
    hi_name = en_name.replace("_message_new", "_hindi_message_new").replace("citizen_", "citizen_") if "hindi" not in en_name else en_name
    for locale, sid, name in [("en_IN", en_sid, en_name), ("hi_IN", hi_sid, en_name)]:
        uid = f"twilio.WHATSAPP.CITIZEN.{action}.{to_state}.{locale}"
        data = {
            "provider": "twilio", "channel": "WHATSAPP", "audience": "CITIZEN",
            "action": action, "toState": to_state, "locale": locale,
            "templateId": sid, "templateName": name, "variables": variables,
            "approvalStatus": "approved", "active": True,
        }
        rows.append((uid, json.dumps(data)))

out = []
out.append("-- NotificationProviderTemplate schema + Twilio WhatsApp CITIZEN mapping (EN+HI)")
out.append(f"""INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, createdtime)
SELECT gen_random_uuid(), '{TENANT}', '{CODE}', 'Provider-scoped external template mapping (e.g. Twilio WhatsApp ContentSids)',
       '{sq(json.dumps(SCHEMA))}'::jsonb, true, 'provider-template-seed', (extract(epoch from now())*1000)::bigint
WHERE NOT EXISTS (SELECT 1 FROM eg_mdms_schema_definition WHERE code='{CODE}' AND tenantid='{TENANT}');""")
for uid, data in rows:
    out.append(f"""INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, createdtime)
SELECT gen_random_uuid(), '{TENANT}', '{uid}', '{CODE}', '{sq(data)}'::jsonb, true, 'provider-template-seed', (extract(epoch from now())*1000)::bigint
WHERE NOT EXISTS (SELECT 1 FROM eg_mdms_data WHERE uniqueidentifier='{uid}' AND schemacode='{CODE}' AND tenantid='{TENANT}');""")

print("\n".join(out))

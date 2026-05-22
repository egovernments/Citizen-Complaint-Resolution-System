---
name: digit-pgr-operations
description: Use when filing, assigning, resolving, rejecting, reopening, or
  rating PGR complaints on DIGIT platform, or when checking complaint status.
---

# DIGIT PGR Operations

PGR complaint lifecycle operations for all personas. Identify the user's role first, then guide them through their specific actions.

---

## PGR State Machine

```dot
digraph pgr_lifecycle {
  rankdir=LR
  node [shape=box style=rounded]

  pending [label="PENDING\nFOR\nASSIGNMENT" style="rounded,filled" fillcolor="#fff3cd"]
  atlme [label="PENDING\nAT LME" style="rounded,filled" fillcolor="#cce5ff"]
  reassign [label="PENDING\nFOR\nREASSIGNMENT" style="rounded,filled" fillcolor="#f8d7da"]
  resolved [label="RESOLVED" style="rounded,filled" fillcolor="#d4edda"]
  rejected [label="REJECTED" style="rounded,filled" fillcolor="#e2e3e5"]
  closed [label="CLOSED\nAFTER\nRESOLUTION" shape=doublecircle style=filled fillcolor="#c3e6cb"]

  pending -> atlme [label="ASSIGN\n(GRO)"]
  pending -> rejected [label="REJECT\n(GRO)"]
  atlme -> resolved [label="RESOLVE\n(LME)"]
  atlme -> reassign [label="REASSIGN\n(LME)"]
  reassign -> atlme [label="REASSIGN\n(GRO)"]
  resolved -> closed [label="RATE\n(Citizen)"]
  resolved -> pending [label="REOPEN\n(Citizen)"]
  rejected -> pending [label="REOPEN\n(Citizen)"]
}
```

---

## Workflow Action Reference

| Action | Who | From Status | To Status | Notes |
|--------|-----|-------------|-----------|-------|
| ASSIGN | GRO | PENDINGFORASSIGNMENT | PENDINGATLME | Do NOT pass assignees — let auto-route |
| REJECT | GRO | PENDINGFORASSIGNMENT | REJECTED | Include comment explaining why |
| RESOLVE | LME | PENDINGATLME | RESOLVED | Auth as LME employee first |
| REASSIGN | LME/GRO | PENDINGATLME/PENDINGFORREASSIGNMENT | PENDINGATLME | Include comment |
| REOPEN | Citizen | RESOLVED/REJECTED | PENDINGFORASSIGNMENT | Auth as citizen first |
| RATE | Citizen | RESOLVED | CLOSEDAFTERRESOLUTION | rating 1-5 required. Terminal state |

---

## Persona-Specific Flows

### Citizen

**Identify by**: "I want to complain about...", "My complaint is still pending...", "How do I report a problem?"

**Leading questions (one at a time)**:
1. "What's the problem you'd like to report? For example: broken streetlight, garbage not collected, pothole, no water supply..."
2. "Where is this? Which area or locality?"
3. "What's your name and mobile number so we can send you updates?"

**Filing a complaint**: Call `pgr_create` silently. Show only:
> "Your complaint has been filed. Your reference number is [ID]. You'll get updates on [mobile]."

**Checking status**: Ask for complaint reference number, call `pgr_search`, describe in plain English:
- PENDINGFORASSIGNMENT → "Your complaint has been received and will be assigned to a field worker soon."
- PENDINGATLME → "Your complaint is with the field team and should be resolved soon."
- RESOLVED → "The field team has resolved your complaint. Would you like to confirm it's fixed?"
- CLOSEDAFTERRESOLUTION → "Your complaint has been resolved and closed."
- REJECTED → "Your complaint was reviewed but could not be processed. Would you like to file a new one?"

**Rating**: If complaint is RESOLVED, ask "Are you satisfied with the resolution? Rate 1-5." Then call `pgr_update(action="RATE", rating=N)`.

**Reopening**: If RESOLVED/REJECTED and citizen says it's not fixed: `pgr_update(action="REOPEN")`.

---

### GRO — Grievance Routing Officer

**Identify by**: "I need to assign a complaint", "Show me pending grievances", "I'm the GRO"

**Leading questions (one at a time)**:
1. "Which city or tenant are you working in?"
2. "Do you want to see all pending complaints, or do you have a specific complaint number?"
3. "Who should I assign this to? I can show you the available field workers."

**View pending**: `pgr_search(tenant_id="...", status="PENDINGFORASSIGNMENT")`
Show as a numbered list with complaint type, locality, and date filed.

**Assign**: `pgr_update(action="ASSIGN", service_request_id="...", tenant_id="...")`
Do NOT pass `assignees` — let PGR auto-route.

**Reject**: `pgr_update(action="REJECT", service_request_id="...", comment="reason")`

**After each action**: Verify with `pgr_search` that status changed as expected.

---

### LME — Last Mile Employee (Field Worker)

**Identify by**: "I'm a field worker", "What complaints are assigned to me?", "I've fixed the issue"

**Leading questions (one at a time)**:
1. "Which city are you working in?"
2. "Do you have a specific complaint number, or should I show you everything assigned to you?"
3. "Is the issue fixed? If yes, I'll mark it resolved."

**View assigned**: `pgr_search(tenant_id="...", status="PENDINGATLME")`

**Resolve**: `pgr_update(action="RESOLVE", service_request_id="...", comment="Fixed: ...")`

**Reassign**: `pgr_update(action="REASSIGN", service_request_id="...", comment="Needs different team")`

**After each action**: Verify status changed via `pgr_search`.

---

### DGRO — Department GRO

**Identify by**: "I manage complaints for [department]", "Show me sanitation / streetlight complaints"

**Leading questions (one at a time)**:
1. "Which department do you manage?"
2. "Which city are you in?"
3. "View pending complaints, assign them, or check resolved ones?"

**Filter**: Use `pgr_search` results filtered by service code matching the department. Use the service code map below.

---

### Viewer / Supervisor

**Identify by**: "How many complaints are pending?", "Give me a summary", "I want to monitor complaints"

**Leading questions (one at a time)**:
1. "Which city or area would you like to see data for?"
2. "Summary of all complaints, or filter by status?"

**Summarize**: Call `pgr_search` with filters, present counts and plain-English breakdown. Never dump raw JSON.

---

## Service Code Map

| Plain English | Service Code | Department |
|---------------|-------------|------------|
| Streetlight not working | `StreetLightNotWorking` | DEPT_1 |
| Garbage not collected | `GarbageNeedsTobeCleared` | DEPT_3 |
| Damaged road / pothole | `DamagedRoad` | DEPT_2 |
| No water supply | `NoWaterSupply` | DEPT_4 |
| Sewage overflow | `BlockOrOverflowingSewage` | DEPT_3 |

Use `validate_complaint_types` to discover all configured service codes for a tenant.

---

## General Principles

- **One question at a time.** Never ask two things in one message.
- **Never show technical IDs, codes, or JSON** to non-technical personas.
- **Always confirm before acting.** Summarize what you'll do, then do it.
- **Verify after each action.** Call `pgr_search` to confirm status changed.
- **If something fails**: Retry once, then "I'm running into a technical issue — let me try a different approach."
- **All DIGIT API calls through MCP tools only.** Never use Bash/curl for DIGIT APIs.

---

## Environment
- **Key**: `chakshu-digit` | **URL**: `https://api.egov.theflywheel.in`
- Always call `configure` first, then `enable_tools(enable=["pgr"])`.

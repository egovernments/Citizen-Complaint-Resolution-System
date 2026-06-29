# CCRS Local Setup Guide

**Stack:** Kong API Gateway → PGR Service → Kafka → Workflow → Postgres  
**UI:** `http://localhost:18080/digit-ui/employee`

---

## Prerequisites

- Ubuntu 20.04+
- Git, Python3, pip3
- Sudo access
- 8 GB RAM, 20 GB disk

---

## Step 1 — Clone

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup
```

---

## Step 2 — Install Ansible

```bash
pip3 install ansible --break-system-packages
```

---

## Step 3 — Deploy

```bash
cd ansible
ANSIBLE_BECOME_PASS="<your-sudo-password>" ansible-playbook -i inventory/hosts.yml playbook-deploy.yml
```

Takes 10–15 min on first run (pulls Docker images). Done when you see `PLAY RECAP`.

---

## Step 4 — Open the UI

```
http://localhost:18080/digit-ui/employee
```

Login: **ADMIN** / **eGov@123** → select city **Pg / Citya**

---

## Step 5 — File a Complaint

1. PGR → **Create Complaint**
2. Select complaint type
3. Fill location dropdowns (County → SubCounty → Ward)
4. Enter 10-digit mobile number starting with 6–9
5. Submit → get reference number `PG-PGR-YYYY-MM-DD-XXXXXX`

---

## Step 6 — Track & Resolve

- **Inbox** — view all complaints with SLA countdown
- **Assign** — GRO assigns to a resolver
- **Resolve** — resolver closes the complaint

---

## Useful Commands

```bash
# Check service health
curl -s http://localhost:18000/pgr-services/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('health'))"

# Gatus health dashboard
http://localhost:18889

# View logs
docker logs digit-pgr-services-1 --tail=50
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `sudo: a password is required` | Set `ANSIBLE_BECOME_PASS="<password>"` |
| Location dropdown empty | Re-run the playbook; seed task runs automatically |
| `INVALID_MOBILE_NUMBER` | Use 10-digit number starting with 6–9 |
| Services not healthy after deploy | Wait 2–3 min; HRMS takes ~3 min to start |

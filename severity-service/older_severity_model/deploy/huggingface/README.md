---
title: CCRS Severity Service
emoji: 🚦
colorFrom: blue
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

Complaint severity API (Low / Medium / High / Critical) for the Citizen Complaint
Resolution System. Swagger UI at `/docs`; `POST /severity`, `POST /severity/batch`, `GET /health`.

If the Space secret `SEVERITY_API_KEY` is set, send it as an `X-API-Key` header.

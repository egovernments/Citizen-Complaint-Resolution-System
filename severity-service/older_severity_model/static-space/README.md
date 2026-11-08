---
title: CCRS Severity
emoji: 🚦
colorFrom: blue
colorTo: red
sdk: static
app_file: index.html
pinned: false
---

Complaint severity (Low / Medium / High / Critical) for the Citizen Complaint Resolution System.
Runs entirely in the browser: no server, no Docker. Open the Space, paste a complaint, press Score.

- `index.html`, `app.js`: the page. The text encoder (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`)
  is loaded with transformers.js from a CDN and cached by the browser.
- `severity.js`: text cleaning + the CatBoost trees evaluated in plain JavaScript.
- `model.json`, `model.bin`: the CatBoost model exported by `scripts/export_static_model.py`
  (matches CatBoost's predictions to 1e-15).

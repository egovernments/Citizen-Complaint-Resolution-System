"""Telemetry for DIGIT local-setup via Matomo HTTP Tracking API.

Usage:
    from telemetry import send_event
    send_event("dataloader", "create", "tenant")

Opt-out: set environment variable TELEMETRY=false
"""

import hashlib
import os
import socket
import threading
import uuid

import requests

MATOMO_URL = "https://unified-demo.digit.org/matomo/matomo.php"
MATOMO_SITE_ID = os.environ.get("MATOMO_SITE_ID", "1")


def _get_visitor_id() -> str:
    """Stable visitor ID: SHA256(hostname + MAC), truncated to 16 hex chars."""
    raw = socket.gethostname() + str(uuid.getnode())
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def send_event(category: str, action: str, name: str = "") -> None:
    """Send a telemetry event (fire-and-forget, non-blocking)."""
    if os.environ.get("TELEMETRY", "true").lower() == "false":
        return

    def _send():
        try:
            requests.post(
                MATOMO_URL,
                data={
                    "idsite": MATOMO_SITE_ID,
                    "rec": "1",
                    "e_c": category,
                    "e_a": action,
                    "e_n": name,
                    "_id": _get_visitor_id(),
                    "url": f"app://local-setup/{category}/{action}",
                    "apiv": "1",
                },
                timeout=5,
            )
        except Exception:
            pass  # fire-and-forget

    threading.Thread(target=_send, daemon=True).start()

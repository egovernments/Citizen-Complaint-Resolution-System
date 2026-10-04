"""A tiny browser for Keycloak's login pages: follows redirects, keeps cookies
and submits the forms Keycloak renders. Standard library only, so the live
check runs anywhere Python 3.9+ does."""

import base64
import hashlib
import html
import http.cookiejar
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Page:
    def __init__(self, url, status, body, location=None):
        self.url, self.status, self.body, self.location = url, status, body, location

    def forms(self):
        """Every <form> as (action, {field: value}), with hidden and prefilled
        inputs already filled in."""
        out = []
        for match in re.finditer(r"<form\b([^>]*)>(.*?)</form>", self.body, re.S | re.I):
            attrs, inner = match.groups()
            action = re.search(r'action="([^"]*)"', attrs)
            fields = {}
            for tag in re.finditer(r"<input\b[^>]*>", inner, re.I):
                name = re.search(r'name="([^"]*)"', tag.group(0))
                if not name:
                    continue
                value = re.search(r'value="([^"]*)"', tag.group(0))
                kind = re.search(r'type="([^"]*)"', tag.group(0))
                # A browser sends only the clicked submit control, never both
                # Continue and Cancel. Callers add the chosen control explicitly.
                if kind and kind.group(1).lower() in ("submit", "button", "reset"):
                    continue
                if kind and kind.group(1).lower() in ("checkbox", "radio") and "checked" not in tag.group(0):
                    continue
                fields[html.unescape(name.group(1))] = html.unescape(value.group(1)) if value else ""
            out.append((html.unescape(action.group(1)) if action else self.url, fields))
        return out

    def form(self, *required_fields):
        for action, fields in self.forms():
            if all(field in fields for field in required_fields):
                return action, fields
        raise AssertionError(
            f"no form with {required_fields} on {self.url} (status {self.status}):\n{self.text()[:1500]}")

    def text(self):
        stripped = re.sub(r"<(script|style)\b.*?</\1>", " ", self.body, flags=re.S | re.I)
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", stripped))).strip()


class _PlainHttpPolicy(http.cookiejar.DefaultCookiePolicy):
    """The test Keycloak is plain http on loopback; still send its Secure cookies."""

    def return_ok_secure(self, cookie, request):
        return True


class Browser:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar(_PlainHttpPolicy())
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), _NoRedirect())

    def request(self, url, data=None, stop_at=None):
        """GET or POST, then follow redirects until a page renders or the
        redirect target starts with `stop_at` (the client's redirect URI)."""
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        for _ in range(20):
            if stop_at and url.startswith(stop_at):
                return Page(url, 302, "", location=url)
            req = urllib.request.Request(url, data=body)
            try:
                with self.opener.open(req) as response:
                    return Page(url, response.status, response.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307):
                    url = urllib.parse.urljoin(url, error.headers["Location"])
                    body = None
                    continue
                return Page(url, error.code, error.read().decode("utf-8", "replace"))
        raise AssertionError("redirect loop")


def pkce_pair():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def post_json(url, form, headers=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), headers=headers or {})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read())


def get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read())

"""Exact text preprocessing used to build TEXT_FOR_MODEL in training (severity model, catboost_pgr.cbm).
Apply this to the raw complaint description before embedding."""
import html, re

def clean(s: str) -> str:
    if not isinstance(s, str):
        return ''
    s = html.unescape(html.unescape(s))            # decodes &#2980;-style Tamil entities and &#13;&#10;
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.replace('​', ' ').replace('﻿', ' ')
    s = re.sub(r'[\r\n\t]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' .,;:-}{')
    return s.strip()

def text_for_model(raw: str) -> str:
    s = clean(raw)
    s = s.split('@', 1)[0] if '@' in s else s        # "Type@address" template -> keep the part before @
    s = re.sub(r'\b\d{4}-[0-9A-Z]{6}\b', ' ', s)    # complaint numbers like 2024-297EJL
    s = re.sub(r'\+?\d[\d\s-]{8,}\d', ' ', s)       # phone numbers
    return re.sub(r'\s+', ' ', s).strip()


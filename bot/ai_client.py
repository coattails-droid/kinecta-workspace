"""Minimal OpenAI-compatible chat client for Kinecta agent workflows.

Expects repo secrets / env:
  AI_API_KEY   (required) — bearer token
  AI_API_BASE  (optional) — default https://api.x.ai/v1 (xAI)
  AI_MODEL     (optional) — default grok-4.7

Works with OpenAI, xAI (https://api.x.ai/v1), and other compatible gateways.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


class AIConfigError(RuntimeError):
    pass


def chat(messages: list[dict], *, temperature: float = 0.7, max_tokens: int = 2000) -> str:
    api_key = os.environ.get("AI_API_KEY", "").strip()
    if not api_key:
        raise AIConfigError(
            "AI_API_KEY is not set. Add it as a repository secret "
            "(Settings → Secrets and variables → Actions), then re-run."
        )
    base = (os.environ.get("AI_API_BASE") or "https://api.x.ai/v1").rstrip("/")
    model = os.environ.get("AI_MODEL") or "grok-4.7"
    url = f"{base}/chat/completions"
    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "kinecta-workspace-agent/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"AI API HTTP {e.code}: {detail}") from e
    try:
        return payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Unexpected AI response shape: {payload!r}"[:500]) from e

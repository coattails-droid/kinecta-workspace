#!/usr/bin/env python3
"""AI PR review agent — posts a GitHub pull request review comment."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ai_client import AIConfigError, chat  # noqa: E402


def gh_api(method: str, path: str, body: dict | None = None) -> dict | list | str:
    token = os.environ["GITHUB_TOKEN"]
    repo = os.environ["REPO"]
    url = f"https://api.github.com/repos/{repo}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kinecta-pr-review-agent/1.0",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {}
            if "application/json" in (resp.headers.get("Content-Type") or ""):
                return json.loads(raw)
            return raw
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"GitHub API {method} {path} -> {e.code}: {detail}") from e


def fetch_diff(pr_number: int) -> str:
    token = os.environ["GITHUB_TOKEN"]
    repo = os.environ["REPO"]
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3.diff",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kinecta-pr-review-agent/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        diff = resp.read().decode("utf-8", errors="replace")
    # Cap size so the model prompt stays bounded
    if len(diff) > 60000:
        diff = diff[:60000] + "\n\n… [diff truncated for review length] …\n"
    return diff


def main() -> int:
    pr_number = int(os.environ["PR_NUMBER"])
    title = os.environ.get("PR_TITLE", "")
    body = os.environ.get("PR_BODY", "") or ""
    author = os.environ.get("PR_AUTHOR", "")

    diff = fetch_diff(pr_number)
    if not diff.strip():
        review_body = (
            "## Automated review\n\n"
            "No diff content was available to review (empty PR or binary-only changes)."
        )
    else:
        system = (
            "You are a careful code reviewer for the kinecta-workspace repo, which mixes "
            "Python GitHub Actions bots (crypto paper trading, digests, research) with a "
            "JavaScript generative-art prototype under seeded-geometries/. "
            "Focus on code quality, clarity, correctness, and consistency with existing style. "
            "Be concise. Do not invent file contents that are not in the diff. "
            "Write Markdown with sections: Strengths, Concerns, Suggestions."
        )
        user = (
            f"PR #{pr_number}: {title}\n"
            f"Author: {author}\n"
            f"Description:\n{body[:3000]}\n\n"
            f"Diff:\n```\n{diff}\n```\n"
        )
        try:
            review_body = chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                max_tokens=1800,
            )
        except AIConfigError as e:
            print(f"CONFIG ERROR: {e}", file=sys.stderr)
            return 2

        review_body = (
            "## Automated PR review (Kinecta agent)\n\n" + review_body + "\n\n"
            "---\n_Posted by `pr-review-agent`. Treat as advisory, not a merge gate._"
        )

    # COMMENT event = comment without approve/request-changes
    result = gh_api(
        "POST",
        f"/pulls/{pr_number}/reviews",
        {"body": review_body, "event": "COMMENT"},
    )
    print(f"Posted review id={result.get('id') if isinstance(result, dict) else result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

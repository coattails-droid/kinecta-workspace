#!/usr/bin/env python3
"""Generate creative graphite/art/design brainstorms for Seeded Geometries."""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ai_client import AIConfigError, chat  # noqa: E402

OUT_DIR = Path("brainstorms")


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return (s[:48] or "ideas").rstrip("-")


def main() -> int:
    topic = (os.environ.get("TOPIC") or "").strip() or (
        "graphite texture, ink-and-bone palettes, and motion motifs for Seeded Geometries"
    )
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%MZ")
    slug = slugify(topic)
    out = OUT_DIR / f"{stamp}-{slug}.md"

    system = (
        "You are a creative director for generative NFT art. "
        "Focus on graphite/pencil aesthetics, geometric lattices, trait systems, "
        "rarity storytelling, and motion/animation ideas. Be concrete and actionable. "
        "Write Markdown with short sections and bullet lists."
    )
    user = (
        f"Brainstorm for the Seeded Geometries collection.\n"
        f"Topic / prompt: {topic}\n\n"
        "Cover:\n"
        "1. Visual / material ideas (graphite, ink, bone, accent hues)\n"
        "2. Trait or rarity concepts that fit a hash-driven generator\n"
        "3. Motion / loop ideas for animated pieces\n"
        "4. Naming / series / drop framing ideas\n"
        "5. 3 stretch concepts that push the system without breaking it\n"
    )

    try:
        body = chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.85,
            max_tokens=2500,
        )
    except AIConfigError as e:
        print(f"CONFIG ERROR: {e}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = (
        f"# Brainstorm — {topic}\n\n"
        f"- **When:** {stamp} UTC\n"
        f"- **Agent:** graphite-brainstorm\n"
        f"- **Collection:** Seeded Geometries\n\n"
        f"---\n\n"
        f"{body}\n"
    )
    out.write_text(doc, encoding="utf-8")
    print(f"Wrote {out}")
    # Expose path for the workflow commit message
    print(f"::set-output name=path::{out}")
    print(f"BRAINSTORM_PATH={out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

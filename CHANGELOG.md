# Changelog

This file is maintained automatically by `.github/workflows/auto-changelog.yml`.

## Format

Each push (except bot changelog commits) prepends a new entry below **Entries**:

- **Date** — UTC timestamp of the commit
- **Author** — commit author
- **Summary** — first line of the commit message
- **Files** — paths changed in that commit

Do not edit entries by hand unless you are correcting a mistake; the next push will keep appending.

---

## Entries

### 2026-09-25 — fix(ci): grant contents: read so checkout works on private repo

- **SHA:** `b67f4e5`
- **When:** 2026-09-25T01:20Z UTC
- **Author:** coattails-droid
- **Summary:** fix(ci): grant contents: read so checkout works on private repo
- **Files:**
  - .github/workflows/failure-detective.yml
  - .github/workflows/price-sentinel.yml

### 2026-09-24 — research: generative NFT seed/hash, traits, and display patterns

- **SHA:** `4c78a29`
- **When:** 2026-09-24T12:43Z UTC
- **Author:** coattails-droid
- **Summary:** research: generative NFT seed/hash, traits, and display patterns
- **Files:**
  - research/2026-09-24-generative-nft-seed-and-traits.md
  - research/INDEX.md

### 2026-09-24 — fix: treat empty AI_API_BASE/AI_MODEL secrets as unset

- **SHA:** `178ef3e`
- **When:** 2026-09-24T12:34Z UTC
- **Author:** coattails-droid
- **Summary:** fix: treat empty AI_API_BASE/AI_MODEL secrets as unset
- **Files:**
  - bot/ai_client.py

### 2026-09-24 — fix: quote auto-changelog job if-expression for valid YAML

- **SHA:** `6db7198`
- **When:** 2026-09-24T12:33Z UTC
- **Author:** coattails-droid
- **Summary:** fix: quote auto-changelog job if-expression for valid YAML
- **Files:**
  - .github/workflows/auto-changelog.yml

### 2026-09-24 — Workspace setup (seeded)

- **Author:** Kinecta / coattails-droid
- **Summary:** Shared workspace created; Work-with-Muse agent fleet copied to repo root; `seeded-geometries/` copied from the private Seeded Geometries NFT art prototype (traits, rarity, animated loops).
- **Files:** repo bootstrap (`bot/`, `.github/workflows/` fleet, `digests/`, `digests-ai/`, `research/`, `docs/`, `README.md`, `requirements.txt`, `seeded-geometries/**`)

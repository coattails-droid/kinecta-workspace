# Change ledger

`changes.jsonl` is the machine-readable record of every commit pushed to `main`, written automatically by `.github/workflows/auto-changelog.yml` (via `bot/change_ledger.py`). `CHANGELOG.md` at the repo root is the human-readable version.

Format: [JSON Lines](https://jsonlines.org/), one JSON object per commit, oldest first. Append-only; never edit past lines.

Fields (schema 1): `sha`, `short_sha`, `authored_at` (ISO 8601), `author_name`, `author_email`, `committer_name`, `parents`, `summary` (first line), `message` (full), `files_changed`, `files` (list of `{status, path}`, status A/M/D), `files_truncated`, `repo`, `branch`, `pushed_by` (GitHub account that pushed), `recorded_at` (UTC), `run_url`, `schema`.

Commits made by the logging workflow itself (`chore: update changelog`) are not recorded.

Example query: `jq -r 'select(.author_name != "dashboard") | [.authored_at, .author_name, .summary] | @tsv' ledger/changes.jsonl`

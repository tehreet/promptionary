# .mulch/

This directory is managed by [mulch](https://github.com/jayminwest/mulch) — a structured expertise layer for coding agents.

## Key Commands

- `ml init`      — Initialize a .mulch directory
- `ml add`       — Add a new domain
- `ml record`    — Record an expertise record
- `ml edit`      — Edit an existing record
- `ml query`     — Query expertise records
- `ml prime [domain]` — Output a priming prompt (optionally scoped to one domain)
- `ml search`   — Search records across domains
- `ml status`    — Show domain statistics
- `ml validate`  — Validate all records against the schema
- `ml prune`     — Remove expired records

## Structure

- `mulch.config.yaml` — Configuration file
- `expertise/`        — JSONL files, one per domain

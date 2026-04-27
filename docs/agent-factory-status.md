# Agent Factory — Status & Handoff (2026-04-27)

This doc captures where the autonomous-issue-to-PR loop stands so a fresh
Claude Code session can resume without re-deriving everything.

## What's wired

```
┌─────────────────────────────────────────────────────────────────┐
│  discord-ticket  (systemd service, /home/joshf/discord-ticket)  │
│  Dr. House MD interviewer in a Discord forum channel.           │
│  Drafts → user clicks Approve → opens GH issue with labels.     │
│  Currently labels: feature/bug/question + secondary (ui, etc.)  │
│  ALREADY RUNNING — `systemctl status discord-ticket` shows      │
│  active.                                                        │
└─────────────────────────────────────────────────────────────────┘
                              │ files GH issue
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  greenhouse  (cron daemon polling GitHub every 10min)           │
│  - .greenhouse/config.yaml — listens for label `agent-ready`    │
│  - .greenhouse/state.jsonl — gitignored runtime state           │
│  - Currently STOPPED. Start with `greenhouse start --detach`.   │
└─────────────────────────────────────────────────────────────────┘
                              │ on poll, dispatches
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  overstory swarm  (.overstory/)                                 │
│  - coordinator (opus) → lead (opus) → builder (sonnet)          │
│  - Plus a greenhouse-spawned supervisor (opus) per run that     │
│    watches and runs ship-protocol when seeds task closes.       │
│  - Quality gates run by builder: bun test/lint/typecheck.       │
└─────────────────────────────────────────────────────────────────┘
                              │ supervisor pushes branch + opens PR
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub PR  → Vercel Preview deploy auto-builds                 │
│  Currently NO automated browser test against the preview.       │
│  PR sits open for human review/merge.                           │
└─────────────────────────────────────────────────────────────────┘
```

## What's been validated

- `discord-ticket` files clean GH issues (Dr. House voice, dedup search,
  draft card with Approve/Edit/Reject).
- `greenhouse poll` ingests issues into seeds and dispatches.
- `spawnSupervisor()` — but only when the daemon's poll cycle dispatches.
  `greenhouse run retry` does NOT spawn one (this was the bug behind the
  early failed runs). Don't use `run retry` for a fresh start.
- Builder agents produce focused, well-scoped diffs (#87 dark-mode fix +
  #94 carousel + spec — both shipped via PR #97 after manual salvage).
- Mulch self-records: builders write learnings on completion. See
  `.mulch/expertise/*.jsonl` — currently 7 domains seeded.

## What's broken / known issues

1. **Overstory hook misclassification of greenhouse's supervisor.** The
   supervisor is a separate Claude Code instance spawned by greenhouse,
   not by `ov sling`. But `.claude/settings.local.json` (installed by
   `ov hooks install`) applies to ANY Claude Code instance run in the
   project root. The supervisor gets blocked from some Bash ops with
   "coordinator agents cannot modify files." Recovery path: supervisor
   delegates to a `shipper-XXXX` agent which then hits its own hook
   issues. Net result on 2026-04-26 dogfood run: builder did the work,
   ship-protocol stalled, salvaged manually as PR #97. Fix idea: the
   supervisor should set an env var or workdir that the hooks recognize
   as "greenhouse supervisor → allow git push + gh ops."

2. **Preview e2e drift.** `bun test:e2e` against a fresh Vercel Preview
   has 15 failing specs vs 51 passing. Three categories:
   - 12 gameplay specs timing out on Supabase anon-auth rate limit
     (4 parallel Playwright workers spawning 2-3 anon sessions each).
     Fix: `playwright.config.ts` workers `4 → 2`.
   - 3 OAuth/passkey specs — likely missing OAuth client IDs in Vercel
     Preview env (or hitting different Supabase project than prod).
   - 1 dark-mode `design-tokens.spec.ts:125` — possibly stale preview
     cache, builder's diff didn't touch `<main>` background.

3. **`agent-verify.sh` was added to `builder.md` but the lead is the one
   that verifies.** Two options for v2: drop the script entirely and
   delegate to CI, or move the requirement into `lead.md`. CI is
   cleaner — see "v2 plan" below.

## v2 plan (not yet shipped)

To get true 10-min/issue throughput:

1. **Drop `agent-verify.sh` from agent-defs.** Browser tests move to CI.
2. **Add `.github/workflows/preview-e2e.yml`** — fires on PR open/sync,
   polls Vercel for the matching `meta.githubCommitSha` deploy, runs
   `PROMPTIONARY_TEST_URL=<preview> PROMPTIONARY_MOCK_GEMINI=1 bun test:e2e`.
3. **Branch protection on `main`** — require the new check + the
   existing build check. Allows `gh pr merge --auto` to actually wait
   for green before merging.
4. **Greenhouse listens for `agent-ready` AND `agent-swarm` labels.**
   discord-ticket's SKILL.md gets a small section to classify scope and
   add the right label. Greenhouse keeps coordinator dispatch (single
   capability per repo per spec); the lead reads the spec and picks
   atomic-vs-swarm internally (atomic = 1 builder, no scout/reviewer;
   swarm = full overstory tree).
5. **Reduce Playwright workers to 2** in `playwright.config.ts` so
   parallel anon-auth bursts stop timing out.
6. **Set Vercel Preview env vars** to mirror prod (OAuth client IDs,
   etc.) so the e2e suite isn't fighting environmental drift.

## Vercel preview env

Already set:
- `PROMPTIONARY_MOCK_GEMINI=1` (Preview only) — set via REST API, var id
  `bR91jXZs75XH22eF`. Lets the e2e suite run mocked-Gemini against the
  deployed preview.

Probably missing (need to verify):
- OAuth client IDs (if Promptionary's Supabase auth providers depend on
  per-env config).

## Per-machine setup if cloning fresh

```bash
ml setup claude              # installs SessionStart + PreCompact mulch hooks
ov hooks install             # installs overstory orchestrator hooks
# ~/.claude/mcp.json: kotadb stdio entry for impact analysis (optional)
```

These write to `.claude/settings.local.json` which is gitignored.

## Where stuff lives

- Greenhouse config: `.greenhouse/config.yaml`
- Greenhouse runtime state (gitignored): `.greenhouse/state.jsonl`,
  `.greenhouse/daemon.log`, `.greenhouse/*-spec.md`
- Overstory config: `.overstory/config.yaml`, `.overstory/agent-defs/*.md`,
  `.overstory/agent-manifest.json`, `.overstory/hooks.json`
- Seeds tasks: `.seeds/issues.jsonl`
- Mulch expertise: `.mulch/expertise/<domain>.jsonl` (seven domains)
- Discord-ticket bot: `/home/joshf/discord-ticket/` (separate repo +
  systemd service); skill at
  `.claude/skills/feature-request-interviewer/SKILL.md`
- Vercel project: `prj_bbIji7EWthbnG135XzhFl2CNr6K7` on team
  `team_9PBy4biwS1zFp6lsUZBEwjMh`

## Resume protocol for a fresh session

1. Read this doc.
2. `git log --show-notes -10` — recent commits have agent-oriented git
   notes that explain why. Especially commits on PRs #82, #95, #96, #97.
3. `cat .greenhouse/config.yaml` — current daemon config. May need
   `daily_cap` / `max_concurrent` tuned before restart.
4. `greenhouse status` to see if daemon is running.
5. Start with v2 plan task 1 (drop agent-verify.sh from agent-defs) →
   2 (CI workflow) → 3 (branch protection) → tune playwright workers → fire
   the daemon and watch one issue end-to-end.

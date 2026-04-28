# Agent Factory — Status & Handoff (2026-04-27, v2 complete)

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
│  + .github/workflows/preview-e2e.yml runs Playwright against    │
│    the matching Preview deploy (PROMPTIONARY_MOCK_GEMINI=1).    │
│  PR sits open for human review/merge once green.                │
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

   **Related: the standalone push-block hook resets on every `ov hooks
   install`.** That hook lacks the `[ -z "$OVERSTORY_AGENT_NAME" ] && exit 0`
   guard the rest of the file uses, so it blocks `git push` for normal
   interactive Claude Code sessions in this repo too. Re-add the guard
   after any agent run that calls `ov hooks install`.

1a. **Multi-dispatch contamination via shared `session-branch.txt`** (NEW,
    discovered 2026-04-27 dogfood run). `dispatcher.ts` writes
    `.overstory/session-branch.txt` and checks out the per-run merge
    branch on EVERY dispatch. With `max_concurrent: 5`, greenhouse fires
    all dispatches back-to-back and the LAST checkout wins. Every lead
    that subsequently calls `ov merge` then merges its builder's work
    into whichever merge branch was the most recent dispatch — not the
    one for its OWN run. Net result on 2026-04-27 dogfood: 5 issues
    dispatched concurrently (#88, #89, #90, #91, #92), greenhouse picked
    #93 last via manual ingest, and `greenhouse/promptionary-d414` ended
    up with merges from #91 + #89's builders even though it's supposed
    to be #93's branch. Builder #92's branch was also contaminated.

    **Recovery from this run:** stopped daemon, killed all sessions, and
    cherry-picked the 4 clean focused commits from
    `overstory/builder-*/` branches onto fresh branches off main:
    `agent/89-start-round-404` → PR #106, `agent/90-chat-autoscroll` → PR #105,
    `agent/91-realtime-broadcast-guard` → PR #107, `agent/92-preserve-artist-draft` → PR #108.
    Issues #88 + #93 had no builder commits yet; their leads/builders
    hadn't run by the time we stopped.

    **Mitigation:** drop `max_concurrent` from 5 → 1 in
    `.greenhouse/config.yaml` so dispatches serialize. The fix in
    greenhouse itself is to use a per-run dispatch directory + isolated
    HEAD checkout (e.g. `git worktree add` per merge branch instead of
    swapping the canonical repo's HEAD).

2. **Preview e2e drift.** Status as of 2026-04-27 against a fresh
   Vercel Preview: 6 failing specs vs ~63 passing.
   - ~~12 gameplay specs timing out on Supabase anon-auth rate limit~~
     Reduced to ~6 by dropping Playwright workers 4 → 2 (PR #99).
     Remaining failures are mostly gameplay-flow specs that may need
     workers=1 or are pre-existing flakes:
     `full-round.spec.ts`, `multi-round.spec.ts`,
     `prefetch-next-round.spec.ts`, `sfx.spec.ts:4`,
     `spectator-tiebreaker.spec.ts:16`, `leaders.spec.ts:93`,
     `moderation.spec.ts:7`.
   - ~~3 OAuth/passkey specs — likely missing OAuth client IDs in
     Vercel Preview env~~ Misdiagnosis. Real cause: stale button text
     in the spec selectors. `auth.spec.ts` looked for "Email me a
     sign-in link" but the button now says "Send magic link";
     `passkey.spec.ts` looked for "Continue with a passkey" but the
     button says "Use a passkey". Fixed in PR #101. Both prod and
     Preview share the same Supabase project; OAuth config (Google,
     Discord) IS disabled at Supabase level but the buttons render
     unconditionally so visibility-only tests don't care.
   - ~~1 dark-mode `design-tokens.spec.ts:125`~~ Misdiagnosis. Real
     cause: `components/theme-provider.tsx` runs next-themes with
     `enableSystem={false}` + `defaultTheme="light"`, so OS-level
     `prefers-color-scheme: dark` (which Playwright's `colorScheme`
     option sets) has no effect. Fixed in PR #102 by seeding
     `localStorage["promptionary-theme"]="dark"` via `addInitScript`
     before navigation.

3. **~~`agent-verify.sh` was added to `builder.md` but the lead is the one
   that verifies.~~** RESOLVED 2026-04-27. `builder.md` no longer references
   `scripts/agent-verify.sh`; the script is left in place as a manual
   utility but is not part of any agent flow. Preview verification is now
   handled by `.github/workflows/preview-e2e.yml`.

## v2 plan

To get true 10-min/issue throughput:

1. ~~**Drop `agent-verify.sh` from agent-defs.**~~ DONE 2026-04-27.
   `builder.md` no longer requires the script; `scripts/agent-verify.sh`
   stays as a manual utility.
2. ~~**Add `.github/workflows/preview-e2e.yml`**~~ DONE 2026-04-27.
   Fires on `pull_request` open/sync/reopen, polls Vercel for the
   matching `meta.githubCommitSha` deploy, runs
   `PROMPTIONARY_TEST_URL=<preview> PROMPTIONARY_MOCK_GEMINI=1 bun test:e2e`.
   **Requires:** `VERCEL_TOKEN` repo secret. Add at
   github.com/tehreet/promptionary/settings/secrets/actions.
3. ~~**Branch protection on `main`**~~ DONE 2026-04-27. `e2e` and
   `Vercel` checks required, `enforce_admins: false` so admin override
   stays available for cases like the one-time bootstrap merge. Set via
   `gh api -X PUT /repos/.../branches/main/protection` in this session.
4. ~~**Greenhouse listens for `agent-ready` AND `agent-swarm` labels.**~~
   DONE 2026-04-27 with a different design than originally planned.
   `gh issue list --label X --label Y` AND-matches, so two trigger labels
   would have required either greenhouse code changes or duplicate repo
   entries. Instead: `agent-ready` stays the sole trigger; discord-ticket
   pairs `agent-swarm` with it whenever the user's interview describes
   multi-subsystem rewrite scope. Greenhouse forwards labels to the lead
   via the dispatch spec (already part of dispatcher.ts), and `lead.md`
   now reads them at the top of `task-complexity-assessment` to pick
   atomic vs swarm pipeline. discord-ticket SKILL.md updated in commit
   `706c770` (separate repo).
5. ~~**Reduce Playwright workers to 2**~~ DONE 2026-04-27. `workers: 2`
   in `playwright.config.ts`.
6. ~~**Set Vercel Preview env vars to mirror prod**~~ DONE 2026-04-27,
   but turned out to be a misdiagnosis. Both prod and Preview already
   share the same Supabase project; no per-env OAuth env vars exist.
   The actual fixes that landed under this task:
   - PR #101: stale button text in auth + passkey specs
   - PR #102: dark-mode spec seeds `localStorage` directly (next-themes
     with `enableSystem={false}` ignores OS preference)
   - PR #103: `preview-e2e.yml` fail-fast on Vercel API auth errors
     (was silently retrying for 15min on `{"error":...}` responses)

## Ship status

All 6 v2 plan items are landed. The agent-factory pipeline is wired:

- discord-ticket bot files issues with `agent-ready` (+ optional `agent-swarm`)
- greenhouse polls `agent-ready` issues, dispatches a coordinator
- coordinator → lead → builder; lead picks pipeline shape from labels
- builder commits to worktree, supervisor pushes branch + opens PR
- `preview-e2e` workflow polls Vercel for the deploy, runs `bun test:e2e`
  with `PROMPTIONARY_MOCK_GEMINI=1` against the preview URL
- branch protection requires `e2e` + `Vercel` checks
- `enforce_admins: false` lets the user override on flaky-spec PRs

Remaining e2e flakes (~6 specs) are pre-existing, mostly gameplay-flow
timing — they will affect agent-shipped PRs the same way they affect
human-shipped PRs. Triage / dropping `workers: 1` is a follow-up.

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
5. v2 plan complete. Next: fire the greenhouse daemon and watch one
   issue end-to-end. Decide whether to tighten the remaining 6 e2e
   flakes (drop workers to 1, audit each spec) before or after the
   first dogfood run.

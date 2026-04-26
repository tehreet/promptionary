#!/usr/bin/env bash
# agent-verify.sh — pre-PR gate for builder agents.
#
# What it does:
#   1. Pushes the current branch to origin.
#   2. Polls the Vercel API for a Preview deploy matching this commit's SHA.
#   3. When the deploy is READY, runs `bun test:e2e` against its URL with
#      PROMPTIONARY_MOCK_GEMINI=1 so the suite finishes in ~30s instead of
#      blocking on real Gemini.
#
# Exit codes:
#   0 — preview READY + e2e green
#   1 — push failed, deploy timed out, deploy errored, or e2e failed
#
# Env knobs:
#   TIMEOUT_SECONDS  (default 600) — how long to wait for READY
#   POLL_INTERVAL    (default 10)  — seconds between polls
#   PROMPTIONARY_VERCEL_PROJECT_ID / _TEAM_ID — override the defaults
#   E2E_GREP         — passed through to playwright as --grep
#
# Prereqs:
#   - jq, curl, bun, git on PATH
#   - vercel CLI logged in (we read its auth.json directly)
#   - PROMPTIONARY_MOCK_GEMINI=1 is set in Vercel's Preview environment so
#     the deployed server short-circuits Gemini calls. (Already configured.)

set -euo pipefail

PROJECT_ID="${PROMPTIONARY_VERCEL_PROJECT_ID:-prj_bbIji7EWthbnG135XzhFl2CNr6K7}"
TEAM_ID="${PROMPTIONARY_VERCEL_TEAM_ID:-team_9PBy4biwS1zFp6lsUZBEwjMh}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-600}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse HEAD)"

if [ "$BRANCH" = "main" ]; then
  echo "✗ Refusing to run agent-verify on main. Switch to a feature branch first." >&2
  exit 1
fi

TOKEN_FILE="$HOME/.local/share/com.vercel.cli/auth.json"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "✗ Vercel auth file not found at $TOKEN_FILE. Run 'vercel login' first." >&2
  exit 1
fi
TOKEN="$(jq -r .token < "$TOKEN_FILE")"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "✗ Vercel auth token is empty. Re-run 'vercel login'." >&2
  exit 1
fi

echo "→ Pushing $BRANCH to origin (sha=${SHA:0:8})..."
git push -u origin "$BRANCH"

echo "→ Waiting for Vercel preview deploy (timeout ${TIMEOUT_SECONDS}s)..."
deadline=$(($(date +%s) + TIMEOUT_SECONDS))
deploy_url=""
deploy_state=""
deploy_id=""

while :; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "✗ Timed out waiting for deploy state=READY" >&2
    exit 1
  fi

  resp=$(curl -sS \
    -H "Authorization: Bearer $TOKEN" \
    "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&meta-githubCommitSha=${SHA}&limit=1" \
    || echo '{}')

  deploy=$(echo "$resp" | jq -c '.deployments[0] // empty')
  if [ -z "$deploy" ]; then
    echo "  no deployment yet for sha=${SHA:0:8}, sleeping ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  deploy_id=$(echo "$deploy" | jq -r .uid)
  deploy_state=$(echo "$deploy" | jq -r .state)
  deploy_url=$(echo "$deploy" | jq -r .url)

  case "$deploy_state" in
    READY)
      echo "✓ Preview READY: https://${deploy_url} (id=${deploy_id})"
      break
      ;;
    ERROR|CANCELED)
      echo "✗ Deploy ${deploy_id} reached terminal state ${deploy_state}" >&2
      echo "  Inspect: https://vercel.com/tehreets-projects/promptionary/${deploy_id}" >&2
      exit 1
      ;;
    *)
      echo "  state=${deploy_state}, sleeping ${POLL_INTERVAL}s..."
      sleep "$POLL_INTERVAL"
      ;;
  esac
done

echo "→ Running bun test:e2e against the preview..."
extra_args=()
if [ -n "${E2E_GREP:-}" ]; then
  extra_args+=("--grep" "$E2E_GREP")
fi

PROMPTIONARY_TEST_URL="https://${deploy_url}" \
  PROMPTIONARY_MOCK_GEMINI=1 \
  bun test:e2e "${extra_args[@]}"

echo "✓ agent-verify green: https://${deploy_url}"

#!/usr/bin/env bash
# Host launcher for the autonomous architecture refactor (docs/REFACTOR-PLAN.md).
#
#   bash scripts/refactor.sh                 # run the whole refactor unattended
#   REFACTOR_DRY_RUN=1 bash scripts/refactor.sh   # verify the plumbing only
#
# The agent runs with --dangerously-skip-permissions INSIDE an isolated container:
# your repo is mounted read-only, the work happens in a container-local clone, and
# the only outputs are a git bundle + logs in ./.refactor-out. On success the
# branch refactor/architecture is imported into this repo for your review.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
BRANCH=refactor/architecture
BUNDLE=.refactor-out/refactor-architecture.bundle

fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }

# ── Preflight ─────────────────────────────────────────────────────────────────
command -v docker >/dev/null || fail "docker is required"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is required"

if [[ -z "${REFACTOR_DRY_RUN:-}" ]]; then
  # Existence check only — .env.builder is operator-owned and never read by agents.
  [[ -f .env.builder ]] || fail ".env.builder not found — put CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in it"
fi

# The container clones HEAD: uncommitted work would silently not participate.
# .claude/settings.local.json is exempt — the operator's live Claude session
# dirties it on every command approval, and it plays no role in the clone.
if [[ -n "$(git status --porcelain -- . ':(exclude).claude/settings.local.json')" ]]; then
  fail "working tree has uncommitted changes — commit or stash first (the agent clones HEAD)"
fi

git show-ref --verify --quiet "refs/heads/$BRANCH" \
  && fail "branch $BRANCH already exists — merge or delete it before a new run"

note "Preflight OK. Building the agent image (cached after first run)…"
mkdir -p .refactor-out/logs
docker compose -f docker-compose.refactor.yml build --quiet

note "Launching the ${REFACTOR_DRY_RUN:+DRY-RUN }refactor container (repo mounted read-only)…"
docker compose -f docker-compose.refactor.yml run --rm refactor
RC=$?
[[ $RC -eq 0 ]] || fail "refactor container exited $RC — see .refactor-out/SUMMARY.md and .refactor-out/logs/"

if [[ -n "${REFACTOR_DRY_RUN:-}" ]]; then
  note "Dry run complete — plumbing verified (see .refactor-out/SUMMARY.md)."
  exit 0
fi

# ── Import the result ─────────────────────────────────────────────────────────
[[ -f "$BUNDLE" ]] || fail "no bundle produced — see .refactor-out/SUMMARY.md"
git bundle verify "$BUNDLE" >/dev/null || fail "bundle failed verification"
git fetch "$BUNDLE" "$BRANCH:$BRANCH"

note "Imported branch $BRANCH:"
git log --oneline "main..$BRANCH"
cat <<EOF

Next steps:
  git diff main...$BRANCH          # review
  bash scripts/smoke.sh            # optional: re-verify on the host
  git merge $BRANCH && git push    # ship (CI runs the full gauntlet)
EOF

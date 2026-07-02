#!/usr/bin/env bash
# Refactor driver (runs as `node` inside the refactor container).
#
# R0: clone /src (read-only host repo) into /work, branch, install, prove the
#     baseline green. Then one Claude Code invocation per plan phase (R1..R6),
#     each followed by an INDEPENDENT gate run — the agent's own claim of green
#     is never trusted. One remediation attempt per phase, then hard stop.
# On success the branch leaves the container as /outbox/refactor-architecture.bundle.
set -uo pipefail

SRC=/src
WORK=/work/grounded-flow
OUT=/outbox
BRANCH=refactor/architecture
PHASES=(R1 R2 R3 R4 R5 R6)

mkdir -p "$OUT/logs"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
  {
    echo "FAILED: $*"
    echo "phase logs: .refactor-out/logs/"
    cd "$WORK" 2>/dev/null && git log --oneline main..HEAD
  } > "$OUT/SUMMARY.md" 2>/dev/null
  exit 1
}

# Gates the runner enforces after every phase, independent of the agent.
gates() {
  local phase="$1"
  log "Runner gates after ${phase}: lint / typecheck / test"
  pnpm lint >>"$OUT/logs/gates-$phase.log" 2>&1 || return 1
  pnpm typecheck >>"$OUT/logs/gates-$phase.log" 2>&1 || return 1
  pnpm test >>"$OUT/logs/gates-$phase.log" 2>&1 || return 1
}

# ── R0: isolated clone + baseline ─────────────────────────────────────────────
log "R0: cloning $SRC (HEAD only — uncommitted host changes are excluded)"
git clone -q "$SRC" "$WORK" || die "clone failed"
cd "$WORK"
git checkout -qb "$BRANCH"
cp -n .env.example .env 2>/dev/null || true

log "R0: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile >"$OUT/logs/install.log" 2>&1 || die "install failed (see logs/install.log)"

log "R0: proving the baseline green before any change"
gates "R0-baseline" || die "baseline is RED — refusing to refactor on a broken base (logs/gates-R0-baseline.log)"

if [[ -n "${REFACTOR_DRY_RUN:-}" ]]; then
  log "DRY RUN complete: clone, install, and baseline gates all green. Exiting before the agent."
  echo "DRY RUN OK $(date -u +%FT%TZ)" > "$OUT/SUMMARY.md"
  exit 0
fi

# ── Phase loop ────────────────────────────────────────────────────────────────
phase_prompt() {
  cat <<EOF
You are an autonomous refactoring agent in an isolated clone at $WORK, on branch $BRANCH.
Read CLAUDE.md, then read docs/REFACTOR-PLAN.md fully. Execute ONLY phase $1.
Perform its Steps, run its Checks yourself, and stop when its DoD holds and the work is
committed as one conventional commit. The plan's Global rules and Environment notes are
binding. Do not start any other phase. Do not push. If the DoD is unreachable, follow
Global rule 6 (honest stop) and exit with a clear failure statement.
EOF
}

remediation_prompt() {
  cat <<EOF
You are the same refactoring agent, in $WORK on branch $BRANCH. Phase $1 was executed but
the runner's independent gates FAILED afterwards. The last 60 lines of gate output:

$(tail -60 "$OUT/logs/gates-$1.log")

Read docs/REFACTOR-PLAN.md phase $1 again, fix forward until lint, typecheck, and the full
test suite pass, and commit the fix (amend or follow-up commit). Do not fake green.
EOF
}

for PHASE in "${PHASES[@]}"; do
  log "Phase $PHASE: launching agent"
  claude --dangerously-skip-permissions -p "$(phase_prompt "$PHASE")" \
    2>&1 | tee "$OUT/logs/phase-$PHASE.log"
  AGENT_RC=${PIPESTATUS[0]}
  [[ $AGENT_RC -eq 0 ]] || die "agent exited $AGENT_RC in phase $PHASE (logs/phase-$PHASE.log)"

  if ! gates "$PHASE"; then
    log "Phase $PHASE gates RED — one remediation attempt"
    claude --dangerously-skip-permissions -p "$(remediation_prompt "$PHASE")" \
      2>&1 | tee "$OUT/logs/phase-$PHASE-remediation.log"
    gates "$PHASE-after-remediation" || die "phase $PHASE still red after remediation"
  fi

  git log --oneline main..HEAD | grep -q . || die "phase $PHASE produced no commit"
  log "Phase $PHASE: gates green, committed"
done

# ── Export ────────────────────────────────────────────────────────────────────
log "All phases green — exporting bundle"
git bundle create "$OUT/refactor-architecture.bundle" main.."$BRANCH" \
  || die "bundle export failed"
{
  echo "# Refactor run — SUCCESS $(date -u +%FT%TZ)"
  echo
  echo "Branch: $BRANCH ($(git rev-list --count main..HEAD) commits)"
  echo
  git log --oneline main..HEAD
  echo
  echo "Import on the host:  bash scripts/refactor.sh  did this automatically;"
  echo "manual equivalent:   git fetch .refactor-out/refactor-architecture.bundle $BRANCH:$BRANCH"
} > "$OUT/SUMMARY.md"
log "Done. Bundle + logs in .refactor-out/"

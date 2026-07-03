#!/usr/bin/env bash
# Refactor driver (runs as `node` inside the refactor container).
#
# R0: clone /src (read-only host repo) into /work, branch, install, prove the
#     baseline green. Then one Claude Code invocation per plan phase (R1..R6),
#     each followed by an INDEPENDENT gate run — the agent's own claim of green
#     is never trusted. One remediation attempt per phase, then hard stop.
#
# Crash-safety (learned the hard way):
# - The branch bundle is (re)exported to /outbox after EVERY green phase, and
#   completed phases are recorded in /outbox/phases-done — a crash loses at
#   most the in-flight phase.
# - On start, an existing bundle + phases-done resumes: the branch is fetched
#   into the fresh clone and completed phases are skipped.
# - A claude launch that fails with a transient API/network error is retried
#   (3 attempts, 60s apart) before the run is declared dead.
set -uo pipefail

SRC=/src
WORK=/work/grounded-flow
OUT=/outbox
BRANCH=refactor/architecture
BUNDLE="$OUT/refactor-architecture.bundle"
DONE_FILE="$OUT/phases-done"
PHASES=(R1 R2 R3 R4 R5 R6)

mkdir -p "$OUT/logs"
touch "$DONE_FILE"

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
  {
    echo "FAILED: $*"
    echo "completed phases: $(tr '\n' ' ' < "$DONE_FILE")"
    echo "phase logs: .refactor-out/logs/  — resume by re-running scripts/refactor.sh"
    cd "$WORK" 2>/dev/null && git log --oneline main..HEAD
  } > "$OUT/SUMMARY.md" 2>/dev/null
  exit 1
}

phase_done() { grep -qx "$1" "$DONE_FILE"; }

export_bundle() {
  git bundle create "$BUNDLE.tmp" main.."$BRANCH" || die "bundle export failed"
  mv "$BUNDLE.tmp" "$BUNDLE"
}

# Gates the runner enforces after every phase, independent of the agent.
gates() {
  local tag="$1"
  log "Runner gates (${tag}): lint / typecheck / test"
  pnpm lint >>"$OUT/logs/gates-$tag.log" 2>&1 || return 1
  pnpm typecheck >>"$OUT/logs/gates-$tag.log" 2>&1 || return 1
  pnpm test >>"$OUT/logs/gates-$tag.log" 2>&1 || return 1
}

# Launch claude; retry only when the failure looks like a transient API/network
# error (an honest agent stop must NOT be retried into submission).
run_agent() {
  local logfile="$1" prompt="$2" attempt rc
  for attempt in 1 2 3; do
    claude --dangerously-skip-permissions -p "$prompt" 2>&1 | tee -a "$logfile"
    rc=${PIPESTATUS[0]}
    [[ $rc -eq 0 ]] && return 0
    if tail -5 "$logfile" | grep -qiE 'unable to connect|connection ?refused|econnreset|econnrefused|fetch failed|socket hang up|overloaded|api error.*(5[0-9][0-9]|429)'; then
      log "Transient API/network error (attempt $attempt/3) — retrying in 60s"
      sleep 60
      continue
    fi
    return "$rc"
  done
  return 1
}

# ── R0: isolated clone, resume if a previous run left a bundle ────────────────
log "R0: cloning $SRC (HEAD only — uncommitted host changes are excluded)"
git clone -q "$SRC" "$WORK" || die "clone failed"
cd "$WORK"

if [[ -s "$DONE_FILE" && -f "$BUNDLE" ]]; then
  log "R0: resuming — fetching previous branch from bundle (done: $(tr '\n' ' ' < "$DONE_FILE"))"
  git bundle verify "$BUNDLE" >/dev/null 2>&1 || die "stale bundle no longer applies (host main moved?) — delete .refactor-out/ to start fresh"
  git fetch -q "$BUNDLE" "$BRANCH:$BRANCH" || die "bundle fetch failed"
  git checkout -q "$BRANCH"
else
  : > "$DONE_FILE"
  git checkout -qb "$BRANCH"
fi
cp -n .env.example .env 2>/dev/null || true

log "R0: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile >"$OUT/logs/install.log" 2>&1 || die "install failed (see logs/install.log)"

log "R0: proving the working base green before any change"
gates "R0-baseline" || die "base is RED — refusing to refactor on a broken base (logs/gates-R0-baseline.log)"

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
  if phase_done "$PHASE"; then
    log "Phase $PHASE: already completed in a previous run — skipping"
    continue
  fi

  log "Phase $PHASE: launching agent"
  run_agent "$OUT/logs/phase-$PHASE.log" "$(phase_prompt "$PHASE")" \
    || die "agent failed in phase $PHASE (logs/phase-$PHASE.log)"

  if ! gates "$PHASE"; then
    log "Phase $PHASE gates RED — one remediation attempt"
    run_agent "$OUT/logs/phase-$PHASE-remediation.log" "$(remediation_prompt "$PHASE")" \
      || die "remediation agent failed in phase $PHASE"
    gates "$PHASE-after-remediation" || die "phase $PHASE still red after remediation"
  fi

  git log --oneline main..HEAD | grep -q . || die "phase $PHASE produced no commit"
  echo "$PHASE" >> "$DONE_FILE"
  export_bundle
  log "Phase $PHASE: gates green, committed, bundle exported"
done

# ── Final export ──────────────────────────────────────────────────────────────
log "All phases green — finalizing"
export_bundle
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

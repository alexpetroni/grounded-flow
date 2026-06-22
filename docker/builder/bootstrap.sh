#!/usr/bin/env bash
# Entrypoint for the builder container. Configures git, then launches the
# Claude Code agent with the bootstrap prompt. Runs sandboxed, so
# --dangerously-skip-permissions is safe here.
set -euo pipefail

cd "${REPO_DIR:-/repo}"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set. Export it or put it in .env." >&2
  exit 1
fi

# Identify commits made by the agent.
git config --global user.email "${GIT_AUTHOR_EMAIL:-builder@rag.local}"
git config --global user.name "${GIT_AUTHOR_NAME:-RAG Builder}"
git config --global --add safe.directory "$(pwd)"

# Sanity: can we reach the host Docker daemon?
if docker info >/dev/null 2>&1; then
  echo "✓ Docker daemon reachable (docker-out-of-docker enabled)."
else
  echo "⚠ Docker daemon NOT reachable — mount /var/run/docker.sock to enable docker-first verification." >&2
fi

PROMPT="$(cat /usr/local/share/rag-builder/PROMPT.md 2>/dev/null || cat docker/builder/PROMPT.md)"

# If a single phase was requested, scope the agent to it.
if [[ -n "${PHASE:-}" ]]; then
  PROMPT="${PROMPT}

SCOPE OVERRIDE: build ONLY Phase ${PHASE} (PHASE-${PHASE}-PLAN.md). Stop after its Definition of Done holds and you have committed."
fi

exec claude --dangerously-skip-permissions -p "$PROMPT"

#!/usr/bin/env bash
# Entrypoint for the builder container. Starts as root to align the Docker
# socket group, then drops to the non-root `node` user (uid 1000 — matches the
# host repo owner) to run the Claude Code agent. Claude Code refuses
# --dangerously-skip-permissions as root, hence the privilege drop. Running
# sandboxed, so skipping permissions is safe here.
set -euo pipefail

cd "${REPO_DIR:-/repo}"

# ── Credentials: EITHER OAuth token (subscription) OR API key. OAuth wins. ──
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "✓ Authenticating with CLAUDE_CODE_OAUTH_TOKEN (subscription)."
  unset ANTHROPIC_API_KEY
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "✓ Authenticating with ANTHROPIC_API_KEY (API billing)."
else
  echo "ERROR: no credentials. Set CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token')" >&2
  echo "       or ANTHROPIC_API_KEY — export it or put it in .env." >&2
  exit 1
fi

# ── Grant the `node` user access to the host Docker socket (DooD) ──
if [[ -S /var/run/docker.sock ]]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
  if ! getent group "$SOCK_GID" >/dev/null; then
    groupadd -g "$SOCK_GID" dockerhost
  fi
  usermod -aG "$(getent group "$SOCK_GID" | cut -d: -f1)" node
  if gosu node docker info >/dev/null 2>&1; then
    echo "✓ Docker daemon reachable as 'node' (docker-out-of-docker enabled)."
  else
    echo "⚠ Docker socket present but not reachable as 'node'." >&2
  fi
else
  echo "⚠ /var/run/docker.sock not mounted — docker-first verification disabled." >&2
fi

# ── Make the mounted repo writable/usable by `node`, and configure git ──
export HOME=/home/node
chown node:node /home/node 2>/dev/null || true
gosu node git config --global user.email "${GIT_AUTHOR_EMAIL:-builder@rag.local}"
gosu node git config --global user.name  "${GIT_AUTHOR_NAME:-RAG Builder}"
gosu node git config --global --add safe.directory "$(pwd)"

PROMPT="$(cat /usr/local/share/rag-builder/PROMPT.md 2>/dev/null || cat docker/builder/PROMPT.md)"

if [[ -n "${PHASE:-}" ]]; then
  PROMPT="${PROMPT}

SCOPE OVERRIDE: build ONLY Phase ${PHASE} (PHASE-${PHASE}-PLAN.md). Stop after its Definition of Done holds and you have committed."
fi

# Drop to non-root `node` and launch the agent (HOME carried for ~/.claude).
exec gosu node env HOME=/home/node claude --dangerously-skip-permissions -p "$PROMPT"

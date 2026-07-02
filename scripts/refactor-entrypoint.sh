#!/usr/bin/env bash
# In-container entrypoint for the refactor agent (runs as root, then drops to
# `node`). Mirrors docker/builder/bootstrap.sh: align the Docker socket group,
# configure git, then hand off — Claude Code refuses --dangerously-skip-permissions
# as root, and the sandbox (ro source mount, isolated clone) is what makes
# skipping permissions safe.
set -euo pipefail

# ── Credentials: OAuth token (subscription) or API key. Not needed for dry runs. ──
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "✓ Authenticating with CLAUDE_CODE_OAUTH_TOKEN (subscription)."
  unset ANTHROPIC_API_KEY
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "✓ Authenticating with ANTHROPIC_API_KEY (API billing)."
elif [[ -n "${REFACTOR_DRY_RUN:-}" ]]; then
  echo "✓ Dry run — no agent credentials required."
else
  echo "ERROR: no credentials. Put CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token')" >&2
  echo "       or ANTHROPIC_API_KEY into .env.builder." >&2
  exit 1
fi

# ── Grant the `node` user access to the host Docker socket (DooD) ──
if [[ -S /var/run/docker.sock ]]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
  getent group "$SOCK_GID" >/dev/null || groupadd -g "$SOCK_GID" dockerhost
  usermod -aG "$(getent group "$SOCK_GID" | cut -d: -f1)" node
  if gosu node docker info >/dev/null 2>&1; then
    echo "✓ Docker daemon reachable as 'node' (docker-out-of-docker enabled)."
  else
    echo "ERROR: Docker socket present but not reachable as 'node'." >&2
    exit 1
  fi
else
  echo "ERROR: /var/run/docker.sock not mounted — verification is impossible." >&2
  exit 1
fi

# ── Workspace + outbox ownership, git identity ──
mkdir -p /work
chown node:node /work /outbox /home/node 2>/dev/null || true
export HOME=/home/node
gosu node git config --global user.email "${GIT_AUTHOR_EMAIL:-refactor@rag.local}"
gosu node git config --global user.name "${GIT_AUTHOR_NAME:-RAG Refactor Agent}"
gosu node git config --global --add safe.directory /src

exec gosu node env HOME=/home/node bash /src/scripts/refactor-driver.sh

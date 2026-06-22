# Builder image: runs the Claude Code agent that constructs the project.
# It needs git, the Docker CLI + compose plugin (to drive the app stack via the
# host Docker socket — "Docker-out-of-Docker"), pnpm, and Claude Code.
FROM node:24-bookworm

# Docker CLI + compose plugin (talks to the host daemon via the mounted socket)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq gosu \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# pnpm (via corepack) + Claude Code
RUN corepack enable \
 && corepack prepare pnpm@latest --activate \
 && npm install -g @anthropic-ai/claude-code

COPY docker/builder/bootstrap.sh /usr/local/bin/bootstrap.sh
RUN chmod +x /usr/local/bin/bootstrap.sh

ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]

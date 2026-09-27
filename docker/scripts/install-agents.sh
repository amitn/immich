#!/usr/bin/env bash
#
# Installs the ACP agents of the AI assistant into one prefix, for the `server-agents` target of server/Dockerfile and
# the `dev-agents` target of server/Dockerfile.dev. Run at image build time; needs node, npm and network access.
#
#   <prefix>/node_modules  the packages, with the native Claude Code and Codex binaries for this platform
#   <prefix>/bin           claude-agent-acp, codex-acp, codex and claude (put this directory on PATH)
#
# The packages are installed together (not with `npm install -g`) so that @openai/codex is shared by codex-acp and the
# `codex` command instead of being installed twice. Optional dependencies must not be omitted: they carry the native
# binaries (@anthropic-ai/claude-agent-sdk-linux-<arch>, @openai/codex-linux-<arch>).

set -euo pipefail

PREFIX="${1:-/opt/immich-agents}"

# Pinned versions. codex-acp depends on @openai/codex ^0.156.1, which the pinned CODEX_VERSION satisfies, so npm uses
# it for both. claude-agent-acp pins @anthropic-ai/claude-agent-sdk (and the Claude Code binary in it) exactly.
CLAUDE_AGENT_ACP_VERSION="${CLAUDE_AGENT_ACP_VERSION:-0.81.2}"
CODEX_ACP_VERSION="${CODEX_ACP_VERSION:-1.13.1}"
CODEX_VERSION="${CODEX_VERSION:-0.156.1}"

mkdir -p "$PREFIX/bin"
cd "$PREFIX"

# a package.json of our own, so that npm installs here and not in a parent directory
if [ ! -f package.json ]; then
  echo '{ "name": "immich-agents", "private": true }' > package.json
fi

npm install --omit=dev --no-audit --no-fund --no-update-notifier --save-exact \
  "@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}" \
  "@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}" \
  "@openai/codex@${CODEX_VERSION}"

for name in claude-agent-acp codex-acp codex; do
  ln -sf "../node_modules/.bin/$name" "bin/$name"
done

# `claude` is the Claude Code CLI bundled with claude-agent-acp (the native binary of @anthropic-ai/claude-agent-sdk),
# the one the adapter runs, for logging in and checking the account: `claude /login`, `claude auth status`.
# `claude-agent-acp --cli` finds the binary for this platform and libc, or uses CLAUDE_CODE_EXECUTABLE when set.
cat > bin/claude << EOF
#!/bin/sh
exec "${PREFIX}/bin/claude-agent-acp" --cli "\$@"
EOF
chmod 755 bin/claude

# fail the build if a binary is missing, e.g. when the native package of this platform wasn't installed
bin/claude-agent-acp --version
bin/codex-acp --version
bin/codex --version
bin/claude --version

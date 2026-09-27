#!/usr/bin/env bash
#
# Checks that the immich-server container can run the AI assistant: the agents, the agent home, the book fonts and
# ffmpeg. Run it inside the container, as the user the server runs as:
#
#   docker exec immich_server immich-check-assistant
#
# It only reads, except for a test file it creates and removes in the agent home. It exits with 1 when a check fails.

set -uo pipefail

failures=0
warnings=0

ok() { echo "  ok    $*"; }
warn() {
  echo "  warn  $*"
  warnings=$((warnings + 1))
}
fail() {
  echo "  FAIL  $*"
  failures=$((failures + 1))
}

echo "User: $(id)"
echo "HOME: ${HOME:-<unset>}"
echo

echo "Agents"
for command in claude-agent-acp codex-acp codex claude; do
  path="$(command -v "$command" 2> /dev/null)"
  if [ -z "$path" ]; then
    fail "$command is not on PATH ($PATH)"
    continue
  fi

  if version="$(timeout 30 "$command" --version 2>&1 | head -n 1)"; then
    ok "$command: $version ($path)"
  else
    fail "$command --version failed: $version"
  fi
done

if [ -n "${CLAUDE_CODE_EXECUTABLE:-}" ]; then
  if [ -x "$CLAUDE_CODE_EXECUTABLE" ]; then
    ok "CLAUDE_CODE_EXECUTABLE=$CLAUDE_CODE_EXECUTABLE"
  else
    fail "CLAUDE_CODE_EXECUTABLE=$CLAUDE_CODE_EXECUTABLE is not executable"
  fi
fi
if [ -n "${CODEX_PATH:-}" ]; then
  if [ -x "$CODEX_PATH" ]; then
    ok "CODEX_PATH=$CODEX_PATH"
  else
    fail "CODEX_PATH=$CODEX_PATH is not executable"
  fi
fi
echo

echo "Agent home"
if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  fail "HOME is not set to a writable directory"
elif [ ! -d "$HOME" ]; then
  fail "$HOME does not exist"
else
  probe="$HOME/.immich-check-assistant.$$"
  if touch "$probe" 2> /dev/null && rm -f "$probe"; then
    ok "$HOME is writable (owner $(stat -c '%u:%g, mode %a' "$HOME"))"
  else
    fail "$HOME is not writable by $(id -u):$(id -g) (owner $(stat -c '%u:%g, mode %a' "$HOME"))"
  fi

  if grep -qs " $HOME " /proc/self/mountinfo; then
    ok "$HOME is a mounted volume"
  else
    warn "$HOME is not a volume; logins are lost when the container is recreated"
  fi
fi
echo

echo "Credentials"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ok "ANTHROPIC_API_KEY is set"
elif [ -s "$HOME/.claude/.credentials.json" ]; then
  ok "Claude Code is logged in ($HOME/.claude/.credentials.json)"
else
  warn "Claude: no ANTHROPIC_API_KEY and no login; run: docker exec -it immich_server claude, then /login"
fi

if [ -s "$HOME/.codex/auth.json" ]; then
  ok "Codex is logged in ($HOME/.codex/auth.json)"
elif [ -n "${OPENAI_API_KEY:-}" ]; then
  warn "OPENAI_API_KEY is set, but Codex isn't logged in; run: docker exec immich_server sh -c 'printenv OPENAI_API_KEY | codex login --with-api-key'"
else
  warn "Codex: no login; run: docker exec -it immich_server codex login --device-auth"
fi
echo

echo "Book fonts"
if command -v fc-match > /dev/null 2>&1; then
  for family in 'Liberation Serif' 'Liberation Sans' 'Liberation Mono' 'FreeSerif' 'FreeSans' 'FreeMono'; do
    match="$(fc-match -f '%{family[0]}' "$family" 2> /dev/null)"
    if [ "$match" = "$family" ]; then
      ok "$family"
    else
      warn "$family is missing (fontconfig uses $match)"
    fi
  done
else
  for dir in /usr/share/fonts/truetype/liberation /usr/share/fonts/truetype/freefont; do
    if [ -d "$dir" ]; then ok "$dir"; else warn "$dir is missing"; fi
  done
fi
echo

echo "ffmpeg (highlight videos)"
ffmpeg="${FFMPEG_PATH:-ffmpeg}"
if path="$(command -v "$ffmpeg" 2> /dev/null)"; then
  ok "$("$ffmpeg" -hide_banner -version 2>&1 | head -n 1) ($path)"
else
  fail "$ffmpeg is not on PATH"
fi
if path="$(command -v ffprobe 2> /dev/null)"; then
  ok "ffprobe ($path)"
else
  fail "ffprobe is not on PATH"
fi
echo

echo "Temporary directory"
tmp="${TMPDIR:-/tmp}"
if probe="$(mktemp -d "$tmp/immich-check-assistant.XXXXXX" 2> /dev/null)"; then
  rmdir "$probe"
  ok "$tmp is writable (agent working directories)"
else
  fail "$tmp is not writable"
fi
echo

echo "$failures failed, $warnings warnings"
[ "$failures" -eq 0 ]

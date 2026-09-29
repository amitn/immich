#!/usr/bin/env bash
#
# Checks that the AI assistant can run. In the gallery-agents container (the agent host), it checks the agents, the
# agent host, the agent home, the logins and the isolation of the container:
#
#   docker exec gallery_agents gallery-check-assistant
#
# Anywhere else (a server that runs the agents itself, outside Docker), it checks the agents, the agent home, the logins,
# the book fonts and ffmpeg, as the user the server runs as:
#
#   bash docker/scripts/check-assistant.sh
#
# It only reads, except for test files it creates and removes in the agent home and the temporary directory. It exits
# with 1 when a check fails.

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

AGENT_HOST_SCRIPT=/opt/gallery-agents/host/agent-host.js
secret="${AGENT_HOST_SECRET:-}"
if [ -f "$AGENT_HOST_SCRIPT" ]; then
  mode=agents
  login="docker exec -it gallery_agents"
else
  mode=server
  login=""
fi

echo "User: $(id)"
echo "HOME: ${HOME:-<unset>}"
echo

if [ "$mode" = server ] && [ -n "${AGENT_HOST_URL:-}" ]; then
  echo "Agent host"
  if node -e "fetch(new URL('/health', process.argv[1]), { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" "$AGENT_HOST_URL" 2> /dev/null; then
    ok "the agent host at $AGENT_HOST_URL answers; the agents run there (check them with: docker exec gallery_agents gallery-check-assistant)"
  else
    fail "the agent host at $AGENT_HOST_URL (AGENT_HOST_URL) does not answer"
  fi
  if [ "${#secret}" -ge 32 ]; then
    ok "AGENT_HOST_SECRET is set"
  else
    fail "AGENT_HOST_SECRET must be set to the secret of the agent host (at least 32 characters)"
  fi
  echo
else
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
    probe="$HOME/.check-assistant.$$"
    if touch "$probe" 2> /dev/null && rm -f "$probe"; then
      ok "$HOME is writable (owner $(stat -c '%u:%g, mode %a' "$HOME"))"
    else
      fail "$HOME is not writable by $(id -u):$(id -g) (owner $(stat -c '%u:%g, mode %a' "$HOME")); a volume from an older setup may belong to root, see the migration notes of the AI assistant docs"
    fi

    if [ "$mode" = agents ]; then
      if grep -qs " $HOME " /proc/self/mountinfo; then
        ok "$HOME is a mounted volume"
      else
        warn "$HOME is not a volume; logins are lost when the container is recreated"
      fi
    fi
  fi
  echo

  echo "Credentials"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    ok "ANTHROPIC_API_KEY is set"
  elif [ -s "$HOME/.claude/.credentials.json" ]; then
    ok "Claude Code is logged in ($HOME/.claude/.credentials.json)"
  else
    warn "Claude: no ANTHROPIC_API_KEY and no login; run: ${login:+$login }claude, then /login"
  fi

  if [ -s "$HOME/.codex/auth.json" ]; then
    ok "Codex is logged in ($HOME/.codex/auth.json)"
  elif [ -n "${OPENAI_API_KEY:-}" ]; then
    warn "OPENAI_API_KEY is set, but Codex isn't logged in; run: ${login:+docker exec gallery_agents }sh -c 'printenv OPENAI_API_KEY | codex login --with-api-key'"
  else
    warn "Codex: no login; run: ${login:+$login }codex login --device-auth"
  fi
  echo
fi

echo "Temporary directory"
tmp="${TMPDIR:-/tmp}"
if probe="$(mktemp -d "$tmp/check-assistant.XXXXXX" 2> /dev/null)"; then
  rmdir "$probe"
  ok "$tmp is writable (agent working directories)"
else
  fail "$tmp is not writable"
fi
echo

if [ "$mode" = agents ]; then
  echo "Agent host"
  port="${AGENT_HOST_PORT:-2285}"
  if node "$AGENT_HOST_SCRIPT" --health; then
    ok "the agent host answers on port $port"
  else
    fail "the agent host does not answer on port $port"
  fi
  if [ "${#secret}" -ge 32 ]; then
    ok "AGENT_HOST_SECRET is set"
  else
    fail "AGENT_HOST_SECRET must be set, to at least 32 characters"
  fi
  echo

  # What an agent (a process of this user in this container) must not be able to do
  echo "Isolation"
  if [ "$(id -u)" -ne 0 ]; then
    ok "runs as user $(id -u), not root"
  else
    fail "runs as root"
  fi

  if ls /data > /dev/null 2>&1; then
    fail "the library is visible in /data; remove the volume from the gallery-agents service"
  else
    ok "no library (ls /data fails)"
  fi

  if cat /proc/1/environ > /dev/null 2>&1; then
    fail "the environment of process 1 is readable"
  else
    ok "the environment of process 1 is not readable (cat /proc/1/environ fails)"
  fi

  host_pid=""
  for dir in /proc/[0-9]*; do
    cmd="$(tr '\0' ' ' < "$dir/cmdline" 2> /dev/null)"
    case "$cmd" in
      *--health*) ;;
      "node $AGENT_HOST_SCRIPT"* | */node\ "$AGENT_HOST_SCRIPT"*)
        host_pid="${dir#/proc/}"
        break
        ;;
    esac
  done
  if [ -z "$host_pid" ]; then
    warn "the agent host process was not found"
  elif cat "/proc/$host_pid/environ" > /dev/null 2>&1; then
    fail "the environment of the agent host (pid $host_pid) is readable"
  else
    ok "the environment of the agent host is not readable (pid $host_pid)"
  fi

  leaked="$(env | cut -d= -f1 | grep -E '^(DB_|REDIS_|IMMICH_|TYPESENSE_|MACHINE_LEARNING_|POSTGRES_)' | tr '\n' ' ')"
  if [ -n "$leaked" ]; then
    fail "server variables are set in this container: $leaked"
  else
    ok "no database, Redis or server variables"
  fi

  if touch /opt/gallery-agents/.check-assistant 2> /dev/null; then
    rm -f /opt/gallery-agents/.check-assistant
    warn "the root filesystem is writable; run the container with read_only: true"
  else
    ok "the root filesystem is read-only"
  fi

  for target in database:5432 redis:6379; do
    if timeout 3 bash -c "echo > /dev/tcp/${target%:*}/${target#*:}" 2> /dev/null; then
      warn "$target is reachable; keep gallery-agents on its own network, with the server only"
    else
      ok "$target is not reachable"
    fi
  done
  echo
else
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
fi

echo "$failures failed, $warnings warnings"
[ "$failures" -eq 0 ]

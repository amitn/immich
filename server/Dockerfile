FROM ghcr.io/immich-app/base-server-dev:202608300913@sha256:188679bfc2e7a496bdc13bd145cf59d90b2fb8f9dbf7131b2c1a368cd637b1a0 AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"

RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
# Gallery patches @immich/ui via pnpm patchedDependencies, so patches/ must be present for every
# `pnpm install --frozen-lockfile` below. Upstream #30874 removed the per-stage bind mounts this
# used to ride on, so it is expressed once here and inherited by every stage built FROM builder.
COPY patches ./patches/

FROM builder AS sdk

COPY ./packages/sdk/package.json ./packages/sdk/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk install --frozen-lockfile

COPY ./packages/sdk ./packages/sdk/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk build

FROM sdk AS plugin-sdk

COPY ./packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/plugin-sdk install --frozen-lockfile

COPY ./packages/plugin-sdk ./packages/plugin-sdk/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/plugin-sdk build

FROM plugin-sdk AS server

COPY ./server/package.json ./server/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich install --frozen-lockfile

COPY ./server ./server/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  pnpm --filter immich build && \
  pnpm --filter immich --prod --no-optional deploy /output/server-pruned
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  SHARP_FORCE_GLOBAL_LIBVIPS=true pnpm --config.verify-deps-before-run=false --dir /output/server-pruned/node_modules/sharp exec npm run build

FROM sdk AS web

COPY ./web/package.json ./web/package.json
# Gallery keeps sharp off the base image's global libvips for the web install; building against it
# has broken this stage before.
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  SHARP_IGNORE_GLOBAL_LIBVIPS=true pnpm --filter immich-web install --frozen-lockfile

COPY ./i18n ./i18n/
COPY ./web ./web/

ARG BUILD_ID
ENV IMMICH_BUILD=${BUILD_ID}

RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich-web build

FROM sdk AS cli

COPY ./packages/cli/package.json ./packages/cli/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/cli install --frozen-lockfile

COPY ./packages/cli ./packages/cli/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  pnpm --filter @immich/cli build && \
  pnpm --filter @immich/cli --prod --no-optional deploy /output/cli-pruned

FROM plugin-sdk AS plugins

ARG TARGETPLATFORM

COPY --from=ghcr.io/jdx/mise:2026.9.2@sha256:812f7860a2fb911e1d5dd3375834abb2a08f8c783a23f783fcbccaf7fc7357aa /usr/local/bin/mise /usr/local/bin/mise

# Gallery does NOT run `mise install --locked` here: resolving the full tool list hits the GitHub
# API and has repeatedly failed the build on rate limits. Only js-pdk is needed, and it is fetched
# on demand by `mise exec` below, with wasm-opt supplied by the binaryen package instead of mise.
# WORKDIR is inherited from builder (/usr/src/app) — the final stage copies plugin-core from there.
COPY ./packages/plugin-core ./packages/plugin-core/
COPY ./packages/plugin-gallery ./packages/plugin-gallery/
ENV MISE_DATA_DIR=/buildcache/mise

RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends binaryen && \
  rm -rf /var/lib/apt/lists/*

# Build plugins
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  --mount=type=cache,id=mise-plugin-tools-${TARGETPLATFORM},target=/buildcache/mise \
  --mount=type=secret,id=github_token \
  if [ -f /run/secrets/github_token ]; then export GITHUB_TOKEN="$(cat /run/secrets/github_token)"; fi; \
  pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery install --frozen-lockfile && \
  mise exec --no-deps --jobs=1 github:extism/js-pdk@1.6.0 -- \
    pnpm --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery build

FROM ghcr.io/immich-app/base-server-prod:202608300913@sha256:e809772a5ee5babfe2073563a40757818f997feff8d161d30bf7b904ca49eb6b AS prod

WORKDIR /usr/src/app
ENV NODE_ENV=production \
  NVIDIA_DRIVER_CAPABILITIES=all \
  NVIDIA_VISIBLE_DEVICES=all

# Fonts of the photo book renderer (see server/src/utils/book/fonts.ts): Liberation Serif/Sans/Mono, metric-compatible
# with Times New Roman and Arial, and GNU FreeFont for scripts they don't cover (Hebrew, Arabic, ...). The base image
# installs no fonts itself (at most DejaVu, through fontconfig-config). fontconfig adds fc-match and the font cache. The base image removed ca-certificates, so the HTTPS
# sources (the PostgreSQL repository) are set aside while the Debian ones are refreshed.
RUN mkdir /tmp/apt-https && \
  for source in /etc/apt/sources.list.d/*; do \
  if grep -q 'https://' "$source"; then mv "$source" /tmp/apt-https/; fi; \
  done && \
  apt-get update && \
  apt-get install --no-install-recommends -yqq fontconfig fonts-liberation fonts-freefont-ttf && \
  apt-get clean && \
  find /tmp/apt-https -type f -exec mv {} /etc/apt/sources.list.d/ \; && \
  rm -rf /tmp/apt-https /var/lib/apt/lists/*

COPY --from=server /output/server-pruned ./server
COPY --from=web /usr/src/app/web/build /build/www
COPY --from=cli /output/cli-pruned ./cli
COPY --from=plugins /usr/src/app/packages/plugin-core/dist /build/plugins/immich-plugin-core/dist
COPY --from=plugins /usr/src/app/packages/plugin-core/manifest.json /build/plugins/immich-plugin-core/manifest.json
COPY --from=plugins /usr/src/app/packages/plugin-gallery/dist /build/plugins/gallery-core/dist
COPY --from=plugins /usr/src/app/packages/plugin-gallery/manifest.json /build/plugins/gallery-core/manifest.json
RUN ln -s ../../cli/bin/immich server/bin/immich
COPY LICENSE /licenses/LICENSE.txt
COPY LICENSE /LICENSE

ENV PATH="${PATH}:/usr/src/app/server/bin"

ARG BUILD_ID
ARG BUILD_IMAGE
ARG BUILD_SOURCE_REF
ARG BUILD_SOURCE_COMMIT

ENV IMMICH_BUILD=${BUILD_ID}
ENV IMMICH_BUILD_URL=https://github.com/immich-app/immich/actions/runs/${BUILD_ID}
ENV IMMICH_BUILD_IMAGE=${BUILD_IMAGE}
ENV IMMICH_BUILD_IMAGE_URL=https://github.com/immich-app/immich/pkgs/container/immich-server
ENV IMMICH_REPOSITORY=immich-app/immich
ENV IMMICH_REPOSITORY_URL=https://github.com/immich-app/immich
ENV IMMICH_SOURCE_REF=${BUILD_SOURCE_REF}
ENV IMMICH_SOURCE_COMMIT=${BUILD_SOURCE_COMMIT}
ENV IMMICH_SOURCE_URL=https://github.com/immich-app/immich/commit/${BUILD_SOURCE_COMMIT}

VOLUME /data
EXPOSE 2283
ENTRYPOINT ["tini", "--", "/bin/bash", "-c"]
CMD ["start.sh"]

HEALTHCHECK CMD immich-healthcheck

# The agent host of the AI assistant (server/src/bin/agent-host.ts) and its MCP stdio bridge, bundled into two
# self-contained files for the gallery-agents image: node built-ins, and the MCP SDK for the bridge.
FROM docker.io/library/node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS agent-host

WORKDIR /build
RUN --mount=type=cache,id=npm-agents,target=/buildcache/npm-agents \
  echo '{ "name": "agent-host-build", "private": true }' > package.json && \
  npm_config_cache=/buildcache/npm-agents npm install --no-audit --no-fund --no-update-notifier --save-exact \
  esbuild@0.28.2 @modelcontextprotocol/sdk@1.30.1

COPY server/tsconfig.json ./
COPY server/src/bin/agent-host.ts server/src/bin/agent-mcp-stdio.ts ./src/bin/
COPY server/src/utils/agent/process.ts server/src/utils/agent/host.ts server/src/utils/agent/host-protocol.ts ./src/utils/agent/
# the banner gives the CommonJS dependencies of the MCP SDK a require()
RUN npx esbuild src/bin/agent-host.ts src/bin/agent-mcp-stdio.ts --bundle --platform=node --format=esm --target=node24 \
  --outdir=/output/host "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && \
  echo '{ "type": "module" }' > /output/host/package.json

# The ACP agents: claude-agent-acp with Claude Code, codex-acp with Codex, at the versions pinned in the script
FROM docker.io/library/node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS agents

RUN --mount=type=bind,source=docker/scripts/install-agents.sh,target=/tmp/install-agents.sh \
  --mount=type=cache,id=npm-agents,target=/buildcache/npm-agents \
  npm_config_cache=/buildcache/npm-agents bash /tmp/install-agents.sh /opt/gallery-agents

# gallery-agents: the ACP agents of the AI assistant in their own container, away from the library, the database and
# the server's environment. The agent host starts them for the server (docker/docker-compose.assistant.yml):
#
#   docker build -f server/Dockerfile --target gallery-agents -t gallery-agents .
#
# Run it as its user (1000), with a read-only root filesystem, a tmpfs /tmp, the agent home as its only volume, and
# AGENT_HOST_SECRET; see docs/docs/features/ai-assistant.md.
FROM docker.io/library/debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS gallery-agents

# tini reaps the processes the agents leave behind. tini and node are execute-only: a process started from a file its
# user can't read is not dumpable, so an agent (the same user) can't read the environment of the agent host or of
# process 1 from /proc, nor trace them. (Only node itself comes from the node image: npm and yarn aren't needed.)
RUN apt-get update && \
  apt-get install --no-install-recommends -yqq ca-certificates tini && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* && \
  chmod 0711 /usr/bin/tini && \
  groupadd --gid 1000 agent && \
  useradd --uid 1000 --gid 1000 --home-dir /var/lib/gallery-agents --no-create-home --shell /bin/bash agent && \
  mkdir -p /var/lib/gallery-agents && \
  chown agent:agent /var/lib/gallery-agents && \
  chmod 700 /var/lib/gallery-agents

COPY --from=agents --chmod=0711 /usr/local/bin/node /usr/local/bin/node
COPY --from=agents /opt/gallery-agents /opt/gallery-agents
COPY --from=agent-host /output/host /opt/gallery-agents/host
COPY --chmod=755 docker/scripts/check-assistant.sh /usr/local/bin/gallery-check-assistant

# The agent home (HOME) is the only place besides /tmp the agents write to: the logins and settings of the CLIs
# (~/.claude, ~/.claude.json, ~/.codex). Mount a volume there to keep them.
ENV NODE_ENV=production \
  HOME=/var/lib/gallery-agents \
  PATH="/opt/gallery-agents/bin:${PATH}" \
  DISABLE_AUTOUPDATER=1 \
  AGENT_HOST_COMMANDS=claude-agent-acp,codex-acp

USER agent
WORKDIR /var/lib/gallery-agents
EXPOSE 2285
ENTRYPOINT ["tini", "--"]
CMD ["node", "/opt/gallery-agents/host/agent-host.js"]

HEALTHCHECK CMD ["node", "/opt/gallery-agents/host/agent-host.js", "--health"]

# The default target is the server
FROM prod

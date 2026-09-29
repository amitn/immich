# Manual test: the assistant's agents in the gallery-agents container (#2)

What the automated tests don't cover: the full stack in Docker Compose, with the real agents logged in, a chat and an
art job, and the isolation of the container as deployed by `docker/docker-compose.assistant.yml`.

Covered already, without Compose:

- unit tests of the transport and the agent host with fake agents (`src/utils/agent/*.spec.ts`,
  `src/repositories/acp.repository.spec.ts`), and a medium test of a whole chat with MCP tools and approvals through an
  in-process agent host (`test/medium/specs/services/agent.service.spec.ts`);
- `src/repositories/acp.repository.container.spec.ts` against a `docker run --rm` of the image, with the fake ACP agent
  mounted into it: a prompt with an MCP tool call from the container, `claude-agent-acp` and `codex-acp` initializing
  in the hardened container, a wrong secret, a command that isn't allowed;
- `gallery-check-assistant` in that container: `ls /data` and `cat /proc/1/environ` fail, the environment of the agent
  host is not readable, no server variables, read-only root, no route to `database` or `redis`.

## Isolation from the other setups

Nothing here touches the running containers (`immich_acp_devdb`, `immich_acp_redis`, `immich_acp_ml`), the dev
services, or the dev databases.

| What              | Test setup                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose project   | `gallery-sidecar-test` (`-p`)                                                                                                                 |
| Containers        | `gsc_server`, `gsc_agents`, `gsc_postgres`, `gsc_redis` (machine learning is disabled)                                                        |
| Ports             | `127.0.0.1:12283` → server. Nothing else is published; the agent host (2285) stays on the compose network                                     |
| Images            | `immich-server:sidecar-test`, `gallery-agents:sidecar-test` (built from the worktree; `immich-server:assistant` is left alone)                 |
| Bind mounts       | `/home/amitn/immich-sidecar-test/library` → `/data` of the server only; `/home/amitn/immich-sidecar-test/postgres` → the database only        |
| Named volumes     | `gallery-sidecar-test_agent-home` → `/var/lib/gallery-agents` of `gsc_agents` only                                                            |
| Networks          | `gallery-sidecar-test_default` (server, database, Redis); `gallery-sidecar-test_agents` (server and agents only)                              |
| Env               | `/home/amitn/immich-sidecar-test/.env` (random `DB_PASSWORD` and `AGENT_HOST_SECRET`); `gsc_agents` gets only the secret and the API keys      |

The prepared files are in `/home/amitn/immich-sidecar-test/`: `.env` and `docker-compose.sidecar-test.yml` (container
names, the port, the env file, no machine learning). It takes about 20 minutes to build (the server image is built from
source) and a few GB of disk.

```bash
cd <worktree>/docker
alias gsc='docker compose -p gallery-sidecar-test --env-file /home/amitn/immich-sidecar-test/.env -f docker-compose.yml -f docker-compose.assistant.yml -f /home/amitn/immich-sidecar-test/docker-compose.sidecar-test.yml'
gsc config -q            # renders; nothing starts
gsc up -d --build
gsc ps                   # gsc_agents and gsc_server healthy
```

## Steps

1. **Check the agent container.** `docker exec gsc_agents gallery-check-assistant`: 0 failed; the login warnings are
   expected before step 3.
2. **Isolation.** Each of these must fail or print nothing:

   ```bash
   docker exec gsc_agents ls /data                          # No such file or directory
   docker exec gsc_agents cat /proc/1/environ               # Permission denied
   docker exec gsc_agents env | grep -E '^(DB_|REDIS_|IMMICH_)'
   docker exec gsc_agents getent hosts database redis       # not resolvable from the agents network
   docker exec gsc_agents touch /opt/x                      # Read-only file system
   ```

   And the container settings: `docker inspect gsc_agents --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.PidsLimit}} {{.HostConfig.Memory}} {{.Config.User}}'`
   shows `true [ALL] 512 4294967296` and the user `agent` (1000); `docker inspect gsc_agents --format '{{json .Mounts}}'`
   lists the agent home only (plus the `/tmp` tmpfs in `.HostConfig.Tmpfs`).

3. **Log in.** `docker exec -it gsc_agents claude`, then `/login` and `/exit`; `docker exec -it gsc_agents codex login --device-auth`.
   Run `gallery-check-assistant` again: both logged in.
4. **Set up Gallery.** Open http://127.0.0.1:12283 (or through an SSH tunnel), create the admin user, upload a few
   photos. In **Administration > Settings > AI Assistant**: enable it, **Chat profile** `claude`, **Art profile**
   `codex`, leave **MCP URL** empty (the server passes `AGENT_MCP_URL`).
5. **Chat.** Ask "How many photos do I have?": a Gallery tool call runs (MCP from the container to
   `http://immich-server:2283`). Ask "Make an album called Sidecar test with my photos": the approval card shows;
   approve; the album exists. While the chat is open, `docker exec gsc_agents ls /tmp/gallery-agents` lists its working
   directory, and `docker logs gsc_agents` shows `Started agent … (claude …)`.
6. **Art job.** On a photo, **Artistic styles** → a style: the artwork appears, stacked with the photo (Codex returns
   the image inline; `output.png` is the fallback read back through the agent host).
7. **Stopping.** Delete the chat: `docker logs gsc_agents` shows the agent exited, and its working directory is gone.
8. **The server goes away.** Start a chat, then `docker restart gsc_server`: `docker logs gsc_agents` shows the agent
   exited within seconds. After the restart, the next message in the chat works (a new agent, loading the session or
   with a recap).
9. **The agent host goes away.** During a chat, `docker restart gsc_agents`: the chat shows an error, and the next
   message starts a new agent once `gsc_agents` is healthy again.
10. **Wrong secret** (optional). Change `AGENT_HOST_SECRET` of `gsc_agents` only (`docker compose … up -d gallery-agents`
    with another value): a message shows _The agent host rejected the secret_; put it back.

## Teardown

```bash
gsc down -v                                     # the containers, the networks and gallery-sidecar-test_agent-home
docker run --rm --user 0 -v /home/amitn/immich-sidecar-test:/t gallery-agents:sidecar-test \
  rm -rf /t/library /t/postgres                 # written by root and the database user
docker image rm immich-server:sidecar-test gallery-agents:sidecar-test
rm -rf /home/amitn/immich-sidecar-test
```

> [!CAUTION]
> Make sure to use the docker-compose.yml of the current release:
> https://github.com/immich-app/immich/releases/latest/download/docker-compose.yml
> 
> The compose file on main may not be compatible with the latest release.

## AI assistant

`docker-compose.assistant.yml` runs the ACP agents of the AI assistant (Claude Code and Codex) in their own container, `gallery-agents`, built from this repository, and keeps their logins on a volume. Set `AGENT_HOST_SECRET` in `.env` (see `example.env`), then:

```bash
docker compose -f docker-compose.yml -f docker-compose.assistant.yml up -d --build
```

`docker-compose.dev.assistant.yml` does the same on top of `docker-compose.dev.yml`. See the [AI assistant setup](https://docs.opennoodle.de/features/ai-assistant#docker) for logging in and checking the container.

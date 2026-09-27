> [!CAUTION]
> Make sure to use the docker-compose.yml of the current release:
> https://github.com/immich-app/immich/releases/latest/download/docker-compose.yml
> 
> The compose file on main may not be compatible with the latest release.

## AI assistant

`docker-compose.assistant.yml` builds the server from this repository with the ACP agents of the AI assistant (Claude Code and Codex) inside it, and keeps their logins on a volume:

```bash
docker compose -f docker-compose.yml -f docker-compose.assistant.yml up -d --build
```

`docker-compose.dev.assistant.yml` does the same on top of `docker-compose.dev.yml`. See the [AI assistant setup](https://docs.immich.app/features/ai-assistant#docker) for logging in and checking the container.

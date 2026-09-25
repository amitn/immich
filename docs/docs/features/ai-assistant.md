# AI Assistant (experimental)

The AI assistant lets you ask for things in plain language, such as _"Make an album of our summer holiday in Italy, about 150 photos, make sure both girls are in it, and crop the portraits to square"_ or _"Turn this album into a 40-page photo book"_. It can also turn photos into artwork, such as a watercolor travel-journal page.

Immich doesn't include an AI model itself. It connects to an AI agent you already use, such as [Claude Code](https://www.anthropic.com/claude-code), [Codex](https://openai.com/codex), Gemini CLI or OpenCode, through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). The agent plans the work, and Immich gives it a small set of photo tools over [MCP](https://modelcontextprotocol.io). With those tools the agent can:

- understand your library: search, people, events and trips, metadata, and viewing photos;
- choose photos: group near-duplicates and bursts, score sharpness, exposure and faces, and pick a balanced selection;
- crop photos around faces;
- create and manage albums;
- design, render and export photo books;
- create artistic versions of photos.

:::caution Experimental
This feature is experimental and disabled by default. The agent runs as a process inside the Immich server container, and when it uses a cloud model, photos it looks at (previews, contact sheets and rendered book pages) are sent to that provider.
:::

## How it works

1. You chat with the assistant on the **Assistant** page of the web app, or pick photos and choose **Ask assistant**.
2. Immich starts the configured agent (for example `claude-agent-acp`) and connects it to Immich's tools. Each tool call is limited to what your user account is allowed to access.
3. The agent can search and look at your photos freely. Actions that change your library, such as creating an album or making a cropped copy, show an **approval prompt** in the chat unless an admin turned on auto-approve.
4. The agent can't use the shell or files on the server: Immich rejects any tool that isn't an Immich tool.

### Crops never change your originals

When the assistant crops a photo, Immich saves the crop as a **new photo**, stacked with the original, which stays the primary photo of the stack. The copy keeps the original's date and location. Crops inside a photo book are stored in the book only.

### Photo books

The assistant can lay out a book from a catalogue of page layouts (full-bleed, 2-up, grids, hero layouts, section openers and more). It renders each page to an image and looks at the result to fix issues such as repetitive pages or poor crops, then exports a print-ready 300 dpi PDF. Open books from the **Books** page.

### Artistic styles

Artistic styles, such as the **editorial watercolor split** (the photo on top and the same scene as a watercolor below, on ivory paper with a handwritten caption), are also made by an ACP agent: one whose model can generate images, for example Codex. The result is saved as a new photo stacked with the original. Use **Artistic style…** in the photo viewer, or ask the assistant.

## Setup

1. Install an ACP agent adapter in the server container. For example, extend the image:

   ```dockerfile
   FROM ghcr.io/immich-app/immich-server:release
   RUN npm install -g @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp
   ```

2. Give the agent its credentials in the server environment, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The default profiles forward these variables to the agent; no other server environment variable (such as database credentials) is passed on.
3. In **Administration > Settings > AI Assistant**:
   - turn the assistant on;
   - check the agent profiles (command, arguments, environment);
   - choose the chat profile and, optionally, the art profile (for example `codex`).

### Settings

| Setting                       | Default                                              | Description                                                                                                                 |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `agent.enabled`               | `false`                                              | Enables the assistant.                                                                                                      |
| `agent.profiles`              | `claude` (`claude-agent-acp`), `codex` (`codex-acp`) | ACP agents that can be started: `command`, `args`, `env`, and `passEnv` (names of server environment variables to forward). |
| `agent.chatProfile`           | `claude`                                             | Profile used for chat sessions.                                                                                             |
| `agent.artProfile`            | _(empty)_                                            | Profile used for artistic styles. Empty disables the feature.                                                               |
| `agent.maxConcurrentSessions` | `3`                                                  | Maximum number of agent processes running at once.                                                                          |
| `agent.idleTimeoutMinutes`    | `15`                                                 | Idle agent processes are stopped after this time. The conversation is kept and resumes on your next message.                |
| `agent.autoApproveWrites`     | `false`                                              | Lets the agent change the library without asking for approval.                                                              |
| `agent.mcpUrl`                | _(empty)_                                            | URL the agent uses to reach Immich's tools. The default is `http://127.0.0.1:<port>/api/agent/mcp`.                         |

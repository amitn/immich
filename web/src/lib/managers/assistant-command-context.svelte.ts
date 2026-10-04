import type { AlbumResponseDto } from '@immich/sdk';
import { page } from '$app/state';

/**
 * The album a page shows, for the assistant's palette commands ("Export as book…", "Name the dishes…" of the album).
 * noodle's own album context (`registerAlbumContext`) is kept to the regular album route on purpose, so that its
 * rename / share / leave / delete commands never reach an album of a space; the assistant's commands work on both.
 */
export type AssistantAlbumContext = {
  album: AlbumResponseDto;
  isOwner: boolean;
  /** an owner or editor of the album */
  isEditor: boolean;
  /** the space of an album of a space */
  space?: { id: string; canWrite: boolean };
};

type Registered = { routeId: string | null; token: symbol; get: () => AssistantAlbumContext };

class AssistantCommandContextManager {
  #registered = $state<Registered | null>(null);

  set(registered: Registered | null) {
    this.#registered = registered;
  }

  clear(token: symbol) {
    if (this.#registered?.token === token) {
      this.#registered = null;
    }
  }

  /** the album of the current page, or null; a context left behind by another route is ignored */
  getAlbum(): AssistantAlbumContext | null {
    const registered = this.#registered;
    if (!registered || registered.routeId !== page.route.id) {
      return null;
    }
    return registered.get();
  }
}

export const assistantCommandContext = new AssistantCommandContextManager();

/** Call in the script of an album page (a regular album or an album of a space) */
export function registerAssistantAlbumContext(get: () => AssistantAlbumContext) {
  const routeId = page.route.id;
  const token = Symbol('assistant-album-context');

  $effect(() => {
    assistantCommandContext.set({ routeId, token, get });
    return () => assistantCommandContext.clear(token);
  });
}

import { getAllTags, type TagResponseDto } from '@immich/sdk';

/** The tags shown in the main sidebar, loaded once and refreshed when tags change */
class SidebarTagsManager {
  tags = $state<TagResponseDto[]>();
  #loading?: Promise<void>;

  get hasTags() {
    return (this.tags?.length ?? 0) > 0;
  }

  load({ force = false } = {}) {
    if (this.#loading || (this.tags && !force)) {
      return this.#loading;
    }

    this.#loading = getAllTags()
      .then((tags) => {
        this.tags = tags;
      })
      .catch(() => {
        this.tags ??= [];
      })
      .finally(() => {
        this.#loading = undefined;
      });
    return this.#loading;
  }
}

export const sidebarTagsManager = new SidebarTagsManager();

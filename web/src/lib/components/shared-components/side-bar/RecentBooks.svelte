<script lang="ts">
  import { page } from '$app/state';
  import { Route } from '$lib/route';
  import { getBookPageRenderUrl } from '$lib/utils';
  import { getBooks, type BookResponseDto } from '@immich/sdk';

  let books = $state<BookResponseDto[]>([]);

  const refreshBooks = async () => {
    try {
      const all = await getBooks();
      books = all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
    } catch {
      books = [];
    }
  };

  // reload when moving between books, so a new or renamed book shows up
  $effect(() => {
    void page.url.pathname;
    void refreshBooks();
  });
</script>

{#each books as book (book.id)}
  <a
    href={Route.viewBook(book)}
    title={book.title}
    aria-current={page.url.pathname === Route.viewBook(book) ? 'page' : undefined}
    class="flex w-full place-items-center justify-between gap-4 rounded-e-full py-3 ps-10 transition-[padding] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary group-hover:sm:px-10 md:px-10 dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary"
  >
    <div>
      <div
        class="size-6 rounded-sm bg-gray-200 bg-cover bg-center dark:bg-gray-600"
        style={book.firstPageId
          ? `background-image:url('${getBookPageRenderUrl({ id: book.id, pageId: book.firstPageId, size: 120, cacheKey: book.updatedAt })}')`
          : ''}
      ></div>
    </div>
    <div class="grow truncate text-sm font-medium">
      {book.title}
    </div>
  </a>
{/each}

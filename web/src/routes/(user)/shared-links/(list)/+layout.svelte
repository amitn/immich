<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import SharedLinkCard from './SharedLinkCard.svelte';
  import { type SharedLinkTab } from '$lib/constants';
  import GroupTab from '$lib/elements/GroupTab.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import {
    getAllSharedLinks,
    getBooks,
    SharedLinkType,
    type BookResponseDto,
    type SharedLinkResponseDto,
  } from '@immich/sdk';
  import { Container } from '@immich/ui';
  import { onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { LayoutData } from './$types';

  type Props = {
    children?: Snippet;
    data: LayoutData;
  };

  const { children, data }: Props = $props();

  let sharedLinks: SharedLinkResponseDto[] = $state([]);
  /** the books of the links to books, for their covers (their first page, as in the list of books) */
  let books = $state(new Map<string, BookResponseDto>());

  const loadBooks = async () => {
    if (sharedLinks.every((link) => !link.book)) {
      return;
    }
    try {
      const list = await getBooks();
      books = new Map(list.map((book) => [book.id, book]));
    } catch (error) {
      // the links still show, with a book icon for a cover
      handleError(error, $t('errors.unable_to_load_books'), { notify: false });
    }
  };

  const refresh = async () => {
    sharedLinks = await getAllSharedLinks({});
    await loadBooks();
  };

  onMount(async () => {
    await refresh();
  });

  const filterMap: Record<SharedLinkTab, string> = {
    all: $t('all'),
    album: $t('albums'),
    individual: $t('individual_shares'),
    book: $t('photo_books'),
  };

  let filters = Object.keys(filterMap);
  let labels = Object.values(filterMap);

  const getActiveTab = (url: URL) => {
    const filter = url.searchParams.get('filter');
    return filter && filters.includes(filter) ? filter : 'all';
  };

  let selectedTab = $derived(getActiveTab(page.url));

  let filteredSharedLinks = $derived(
    sharedLinks.filter(
      ({ type }) =>
        selectedTab === 'all' ||
        (type === SharedLinkType.Album && selectedTab === 'album') ||
        (type === SharedLinkType.Individual && selectedTab === 'individual') ||
        (type === SharedLinkType.Book && selectedTab === 'book'),
    ),
  );

  const onSharedLinkUpdate = (sharedLink: SharedLinkResponseDto) => {
    const index = sharedLinks.findIndex((link) => link.id === sharedLink.id);
    if (index !== -1) {
      sharedLinks[index] = sharedLink;
    }
  };

  const onSharedLinkDelete = (sharedLink: SharedLinkResponseDto) => {
    sharedLinks = sharedLinks.filter(({ id }) => id !== sharedLink.id);
  };
</script>

<OnEvents {onSharedLinkUpdate} {onSharedLinkDelete} />

<UserPageLayout title={data.meta.title}>
  {#snippet buttons()}
    <div class="hidden h-10 xl:block">
      <GroupTab
        label={$t('show_shared_links')}
        {filters}
        {labels}
        selected={selectedTab}
        onSelect={(value) => goto(Route.sharedLinks({ filter: value as SharedLinkTab }))}
      />
    </div>
  {/snippet}

  <Container center size="medium">
    {#if sharedLinks.length === 0}
      <div
        class="flex place-content-center place-items-center rounded-lg bg-gray-100 p-12 dark:bg-immich-dark-gray dark:text-immich-gray"
      >
        <p>{$t('you_dont_have_any_shared_links')}</p>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each filteredSharedLinks as sharedLink (sharedLink.id)}
          <SharedLinkCard {sharedLink} book={sharedLink.book ? books.get(sharedLink.book.id) : undefined} />
        {/each}
      </div>
    {/if}

    {@render children?.()}
  </Container>
</UserPageLayout>

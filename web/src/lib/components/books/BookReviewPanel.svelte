<script lang="ts">
  import { openAssistant } from '$lib/services/assistant.service';
  import { locale } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl, getPeopleThumbnailUrl } from '$lib/utils';
  import {
    BOOK_REVIEW_ISSUE_LABEL_KEYS,
    BOOK_REVIEW_SEVERITY_LABEL_KEYS,
    formatBookPageList,
    getBookReviewFixAllPrompt,
    getBookReviewFixPrompt,
    getBookReviewUnusedPrompt,
    groupBookReviewIssues,
  } from '$lib/utils/book-review';
  import { generateId } from '$lib/utils/generate-id';
  import {
    AssetMediaSize,
    Severity,
    type BookDetailResponseDto,
    type BookReviewIssueDto,
    type BookReviewResponseDto,
    type BookReviewSuggestionDto,
  } from '@immich/sdk';
  import { Button, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiAccountOutline,
    mdiAlertCircleOutline,
    mdiAlertOutline,
    mdiCheckCircleOutline,
    mdiClose,
    mdiCreationOutline,
    mdiInformationOutline,
    mdiRefresh,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    id: string;
    book: Pick<BookDetailResponseDto, 'id' | 'title'>;
    review?: BookReviewResponseDto;
    loading?: boolean;
    failed?: boolean;
    onRefresh: () => void;
    /** One-based page, and one-based slot when the issue is about one photo */
    onGoToPage: (page: number, slot?: number) => void;
    onClose: () => void;
  };

  const { id, book, review, loading = false, failed = false, onRefresh, onGoToPage, onClose }: Props = $props();

  const headingId = $derived(`${id}-heading`);
  const uid = generateId();

  let heading = $state<HTMLElement>();
  let brokenAvatars = $state<Record<string, boolean>>({});

  const severityIcons: Record<Severity, { icon: string; class: string }> = {
    [Severity.High]: { icon: mdiAlertCircleOutline, class: 'text-red-600 dark:text-red-400' },
    [Severity.Medium]: { icon: mdiAlertOutline, class: 'text-amber-600 dark:text-amber-400' },
    [Severity.Low]: { icon: mdiInformationOutline, class: 'text-gray-500 dark:text-gray-400' },
  };

  const groups = $derived(groupBookReviewIssues(review?.issues ?? []));
  const unused = $derived(review?.unusedPhotos ?? []);
  const weakest = $derived(review?.weakestPlaced ?? []);
  const people = $derived(review?.people ?? []);

  const issueLabel = (issue: BookReviewIssueDto) => {
    const key = BOOK_REVIEW_ISSUE_LABEL_KEYS[issue.type];
    return key ? $t(key) : issue.type;
  };

  const pagesLabel = (issue: BookReviewIssueDto) => {
    const pages = $t('book_review_pages', {
      values: { count: issue.pages.length, pages: formatBookPageList(issue.pages, $locale) },
    });
    return issue.slot !== undefined && issue.pages.length === 1
      ? $t('book_review_pages_slot', { values: { pages, slot: issue.slot } })
      : pages;
  };

  const photoLabel = (photo: BookReviewSuggestionDto) =>
    [photo.people?.join(', '), photo.city].filter(Boolean).join(' · ') || $t('book_review_unused_photo');

  const handleGoTo = (issue: BookReviewIssueDto) =>
    onGoToPage(issue.pages[0], issue.pages.length === 1 ? issue.slot : undefined);

  const handleFix = (issue: BookReviewIssueDto) =>
    openAssistant({ prompt: getBookReviewFixPrompt($t, book, issue, $locale), assetIds: issue.assetIds });

  const handleFixAll = () =>
    openAssistant({ prompt: getBookReviewFixAllPrompt($t, book, review?.issues ?? [], $locale) });

  const handleUseUnused = () =>
    openAssistant({
      prompt: getBookReviewUnusedPrompt($t, book, unused.length),
      assetIds: unused.map(({ assetId }) => assetId),
    });

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  onMount(() => heading?.focus());
</script>

<!-- below the navigation bar and the page header (h-16), so the header buttons stay usable -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  {id}
  aria-labelledby={headingId}
  class="fixed inset-e-0 top-[calc(var(--navbar-height)+(--spacing(16)))] bottom-0 z-20 flex w-full flex-col border-s border-gray-200 bg-light text-dark shadow-xl max-md:top-[calc(var(--navbar-height-md)+(--spacing(16)))] sm:w-96 dark:border-gray-700"
  {onkeydown}
>
  <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
    <h2 bind:this={heading} id={headingId} tabindex="-1" class="grow text-base font-medium outline-none">
      {$t('book_review_title')}
    </h2>
    <IconButton
      variant="ghost"
      size="small"
      color="secondary"
      shape="round"
      icon={mdiRefresh}
      disabled={loading}
      aria-label={$t('book_review_refresh')}
      title={$t('book_review_refresh')}
      onclick={onRefresh}
    />
    <IconButton
      variant="ghost"
      size="small"
      color="secondary"
      shape="round"
      icon={mdiClose}
      aria-label={$t('book_review_close')}
      title={$t('book_review_close')}
      onclick={onClose}
    />
  </div>

  <div class="flex grow immich-scrollbar flex-col gap-6 overflow-y-auto p-4" aria-busy={loading}>
    {#if !review}
      {#if loading}
        <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" role="status">
          <LoadingSpinner size="small" />
          {$t('book_review_loading')}
        </div>
      {:else if failed}
        <div class="flex flex-col items-start gap-2" role="alert">
          <p class="text-sm text-gray-600 dark:text-gray-400">{$t('errors.unable_to_load_book_review')}</p>
          <Button size="small" shape="round" color="secondary" leadingIcon={mdiRefresh} onclick={onRefresh}>
            {$t('book_review_refresh')}
          </Button>
        </div>
      {/if}
    {:else}
      <p class="sr-only" role="status">
        {loading
          ? $t('book_review_loading')
          : $t('book_review_summary', {
              values: { high: review.counts.high, medium: review.counts.medium, low: review.counts.low },
            })}
      </p>

      {#if groups.length === 0}
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <Icon icon={mdiCheckCircleOutline} size="40" class="text-green-600 dark:text-green-400" aria-hidden />
          <p class="font-medium">{$t('book_review_no_issues')}</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">{$t('book_review_no_issues_description')}</p>
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          <Button size="small" shape="round" leadingIcon={mdiCreationOutline} onclick={handleFixAll}>
            {$t('book_review_fix_all')}
          </Button>

          {#each groups as group (group.severity)}
            {@const style = severityIcons[group.severity]}
            {@const groupHeadingId = `${uid}-${group.severity}`}
            <section aria-labelledby={groupHeadingId} data-severity={group.severity}>
              <h3 id={groupHeadingId} class="mb-2 flex items-center gap-2 text-sm font-medium">
                <Icon icon={style.icon} size="18" class={style.class} aria-hidden />
                {$t(BOOK_REVIEW_SEVERITY_LABEL_KEYS[group.severity])}
                <span class="text-gray-500 dark:text-gray-400">({group.issues.length})</span>
              </h3>
              <ul class="flex flex-col gap-2">
                {#each group.issues as issue, index (index)}
                  <li class="rounded-xl border border-gray-200 dark:border-gray-700">
                    {#if issue.pages.length > 0}
                      <button
                        type="button"
                        class="flex w-full flex-col items-start gap-1 rounded-t-xl p-3 text-start outline-offset-2 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-gray-800"
                        onclick={() => handleGoTo(issue)}
                      >
                        <span class="text-sm font-medium">{issueLabel(issue)}</span>
                        <span class="text-sm text-gray-700 dark:text-gray-300">{issue.message}</span>
                        <span class="text-xs font-medium text-primary">{pagesLabel(issue)}</span>
                      </button>
                    {:else}
                      <div class="flex flex-col gap-1 p-3">
                        <span class="text-sm font-medium">{issueLabel(issue)}</span>
                        <span class="text-sm text-gray-700 dark:text-gray-300">{issue.message}</span>
                      </div>
                    {/if}
                    <div class="px-2 pb-2">
                      <Button
                        size="tiny"
                        variant="ghost"
                        shape="round"
                        color="secondary"
                        leadingIcon={mdiCreationOutline}
                        aria-label={$t('book_review_fix_issue', { values: { issue: issueLabel(issue) } })}
                        onclick={() => handleFix(issue)}
                      >
                        {$t('book_review_fix')}
                      </Button>
                    </div>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}

      {#if unused.length > 0}
        <section aria-labelledby="{uid}-unused" class="flex flex-col gap-2">
          <h3 id="{uid}-unused" class="text-sm font-medium">{$t('book_review_unused_photos')}</h3>
          <p class="text-xs text-gray-600 dark:text-gray-400">{$t('book_review_unused_photos_description')}</p>
          <!-- a grid that fits the panel, so no thumbnail is cut off at its edge -->
          <ul class="grid grid-cols-6 gap-2">
            {#each unused as photo (photo.assetId)}
              <li class="min-w-0">
                <img
                  src={getAssetMediaUrl({ id: photo.assetId, size: AssetMediaSize.Thumbnail })}
                  alt={photoLabel(photo)}
                  title={photoLabel(photo)}
                  loading="lazy"
                  draggable="false"
                  class="aspect-square w-full rounded-lg bg-gray-100 object-cover dark:bg-gray-800"
                />
              </li>
            {/each}
          </ul>
          <Button
            size="small"
            shape="round"
            variant="ghost"
            color="secondary"
            leadingIcon={mdiCreationOutline}
            onclick={handleUseUnused}
          >
            {$t('book_review_use_unused')}
          </Button>
        </section>
      {/if}

      {#if weakest.length > 0}
        <section aria-labelledby="{uid}-weakest" class="flex flex-col gap-2">
          <h3 id="{uid}-weakest" class="text-sm font-medium">{$t('book_review_weakest_photos')}</h3>
          <p class="text-xs text-gray-600 dark:text-gray-400">{$t('book_review_weakest_photos_description')}</p>
          <ul class="grid grid-cols-6 gap-2">
            {#each weakest as placement (`${placement.page}-${placement.slot}`)}
              {@const label = $t('book_review_go_to_photo', {
                values: { page: placement.page, slot: placement.slot },
              })}
              <li class="min-w-0">
                <button
                  type="button"
                  class="block w-full rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
                  aria-label={label}
                  title={label}
                  onclick={() => onGoToPage(placement.page, placement.slot)}
                >
                  <img
                    src={getAssetMediaUrl({ id: placement.assetId, size: AssetMediaSize.Thumbnail })}
                    alt=""
                    loading="lazy"
                    draggable="false"
                    class="aspect-square w-full rounded-lg bg-gray-100 object-cover dark:bg-gray-800"
                  />
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if people.length > 0}
        <section aria-labelledby="{uid}-people" class="flex flex-col gap-2">
          <h3 id="{uid}-people" class="text-sm font-medium">{$t('book_review_people')}</h3>
          <p class="text-xs text-gray-600 dark:text-gray-400">{$t('book_review_people_description')}</p>
          <ul class="flex flex-col gap-2">
            {#each people as person (person.personId)}
              <li class="flex items-center gap-3">
                <span
                  class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                >
                  {#if brokenAvatars[person.personId]}
                    <Icon icon={mdiAccountOutline} size="20" class="text-gray-500" aria-hidden />
                  {:else}
                    <img
                      src={getPeopleThumbnailUrl({ id: person.personId })}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      class="size-full object-cover"
                      onerror={() => (brokenAvatars[person.personId] = true)}
                    />
                  {/if}
                </span>
                <span class="flex min-w-0 grow flex-col">
                  <span class="truncate text-sm font-medium">{person.name || $t('unknown')}</span>
                  <span
                    class="text-xs {person.placed === 0
                      ? 'font-medium text-amber-700 dark:text-amber-400'
                      : 'text-gray-600 dark:text-gray-400'}"
                  >
                    {$t('book_review_person_count', { values: { placed: person.placed, photos: person.photos } })}
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>
</aside>

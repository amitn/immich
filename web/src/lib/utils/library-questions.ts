import type { CollectionPackSummaryDto, CollectionSummaryResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

/** how many example questions the assistant's empty state shows */
export const LIBRARY_QUESTION_COUNT = 4;

/** a question about one pack of the user's collections, e.g. "What did we eat at Noma Australia?" */
const getPackQuestion = ($t: MessageFormatter, pack: CollectionPackSummaryDto, index: number) => {
  const place = pack.recentPlaces[index]?.name;
  const year = pack.years.at(-1);
  switch (pack.pack) {
    case 'food': {
      return place ? $t('assistant_question_food', { values: { place } }) : undefined;
    }
    case 'cookbook': {
      return place ? $t('assistant_question_cookbook', { values: { place } }) : undefined;
    }
    case 'museum': {
      return year ? $t('assistant_question_museum', { values: { year: String(year) } }) : undefined;
    }
    case 'travel': {
      return place ? $t('assistant_question_travel', { values: { place } }) : undefined;
    }
    default: {
      // a pack the web doesn't know yet (e.g. wine) asks about its last place
      return place ? $t('assistant_question_place', { values: { place } }) : undefined;
    }
  }
};

/**
 * Example questions about the library for the assistant's empty state, built from what the collections hold (the
 * most recent place of each pack first, then older places), or generic ones when there are no named collections yet
 */
export const getLibraryQuestions = ($t: MessageFormatter, summary?: CollectionSummaryResponseDto): string[] => {
  const packs = (summary?.packs ?? []).filter(({ photos }) => photos > 0);
  if (packs.length === 0) {
    return [
      $t('assistant_question_generic_last_time'),
      $t('assistant_question_generic_museums'),
      $t('assistant_question_generic_day'),
      $t('assistant_question_generic_collections'),
    ];
  }

  const questions: string[] = [];
  const depth = Math.max(...packs.map(({ recentPlaces }) => recentPlaces.length), 1);
  for (let index = 0; index < depth && questions.length < LIBRARY_QUESTION_COUNT - 1; index++) {
    for (const pack of packs) {
      const question = getPackQuestion($t, pack, index);
      if (question && !questions.includes(question) && questions.length < LIBRARY_QUESTION_COUNT - 1) {
        questions.push(question);
      }
    }
  }
  questions.push($t('assistant_question_generic_collections'));
  return questions;
};

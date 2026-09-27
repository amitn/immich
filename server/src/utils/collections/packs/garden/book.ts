import { GROWTH_TIMELINE_LAYOUTS } from 'src/utils/book/layouts.js';
import {
  CollectionCaptionContext,
  CollectionDescribedPhoto,
  CollectionReviewInput,
  CollectionReviewIssue,
} from 'src/utils/collections/pack.js';
import { getGrowthStage } from 'src/utils/collections/packs/garden/plants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Feb 2013", from a local time in ms */
export const formatGardenDate = (time: number) => {
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/** the description save_entries writes on a plant photo: the plant, and its growth stage when CLIP can tell it */
export const describePlant = (plant: string, photo?: CollectionDescribedPhoto) => {
  const stage = photo?.similarities ? getGrowthStage(photo.similarities) : undefined;
  return stage ? `${plant.trim()} · ${stage}` : plant.trim();
};

/**
 * The caption of a plant photo in a book. On a growth-timeline page it is the date and the stage, e.g. "1 Feb 2013\n
 * flowering": the stage save_entries wrote in the description ("Peach 'Tropic Prince' · flowering"), or the user's
 * own note there. Elsewhere it is the plant, as tagged.
 */
export const getPlantCaption = (plant: string, context: CollectionCaptionContext = {}) => {
  if (!context.layout || !GROWTH_TIMELINE_LAYOUTS.includes(context.layout)) {
    return plant;
  }
  const description = context.description?.trim() ?? '';
  const prefix = `${plant.trim()} · `;
  const note = description.startsWith(prefix)
    ? description.slice(prefix.length)
    : description === plant.trim()
      ? ''
      : description;
  const date = context.takenAt === undefined ? undefined : formatGardenDate(context.takenAt);
  return [date, note].filter(Boolean).join('\n');
};

/** the title of the chapter of a plant: "Peach 'Tropic Prince' · Hawea Pl garden" */
export const getPlantChapterTitle = (plant: string, garden: string) => `${plant} · ${garden}`;

/** a name the assistant could not give: a placeholder */
export const isUnnamedPlant = (plant: string) =>
  /^(?:unknown|unnamed|plant|tree|tag|unread|\?+)(?:\s+\d+)?$/i.test(plant.trim());

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The checks of a garden journal: plants without a name, and plants shown on a single photo (a timeline needs at
 * least two dates)
 */
export const reviewGardenBook = ({ chapters, photos }: CollectionReviewInput): CollectionReviewIssue[] => {
  const issues: CollectionReviewIssue[] = [];
  const times = new Map(photos.map((photo) => [photo.id, photo.takenAt]));
  for (const chapter of chapters) {
    const unnamed = chapter.placed.filter(({ entry }) => isUnnamedPlant(entry));
    if (unnamed.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'missing-dish-name',
        message:
          `The garden journal shows ${plural(unnamed.length, 'plant')} without a variety (e.g. "${unnamed[0].entry}"): ` +
          'read their tags and save their names ("Peach \'Tropic Prince\'")',
        pages: chapter.pages,
        assetIds: unnamed.flatMap(({ assetIds }) => assetIds).slice(0, 6),
      });
    }
    for (const { entry, assetIds } of chapter.placed) {
      const days = new Set(assetIds.map((id) => new Date(times.get(id) ?? 0).toISOString().slice(0, 10)));
      const available = chapter.available.find((item) => item.entry === entry)?.assetIds ?? [];
      const more = available.filter((id) => !assetIds.includes(id));
      if (days.size === 1 && more.length > 0) {
        issues.push({
          severity: 'low',
          type: 'could-look-better',
          message:
            `${entry} is shown on one day only, but has ${plural(more.length, 'more photo')} in the album: add ` +
            'them to its growth timeline',
          pages: chapter.pages,
          assetIds: more.slice(0, 6),
        });
      }
    }
  }
  return issues;
};

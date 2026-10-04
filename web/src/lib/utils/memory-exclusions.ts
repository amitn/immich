import { MemoryExclusionType, type MemoryExclusionResponseDto } from '@immich/sdk';

/**
 * Gallery fork (#12): what a memory exclusion is called in the settings, e.g. "Dana", "Work" or "1 – 14 March 2026".
 * Dates are local days (`YYYY-MM-DD`), formatted in the viewer's language.
 */

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** a range of days, e.g. "1 – 14 March 2026", or one day */
export const formatExclusionDays = (startDate: string, endDate: string, locale?: string) => {
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return startDate === endDate
    ? format.format(toDate(startDate))
    : format.formatRange(toDate(startDate), toDate(endDate));
};

export const getExclusionName = (exclusion: MemoryExclusionResponseDto, locale?: string) => {
  switch (exclusion.type) {
    case MemoryExclusionType.Person: {
      return exclusion.person?.name ?? '';
    }
    case MemoryExclusionType.Album: {
      return exclusion.album?.albumName ?? '';
    }
    case MemoryExclusionType.DateRange: {
      return exclusion.startDate && exclusion.endDate
        ? formatExclusionDays(exclusion.startDate, exclusion.endDate, locale)
        : '';
    }
  }
  return '';
};

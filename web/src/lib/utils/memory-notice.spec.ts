import { MemoryType } from '@immich/sdk';
import { IntlMessageFormat } from 'intl-messageformat';
import type { MessageFormatter } from 'svelte-i18n';
import en from '$i18n/en.json';
import { getDraftNotice, getMemoryNotice, getNotificationText } from '$lib/utils/memory-notice';
import { getNotificationRoute } from '$lib/utils/notification';

/** the real English messages, so a renamed key or a missing placeholder fails here */
const translate = ((key: string, payload?: { values?: Record<string, unknown> }) => {
  const message = (en as unknown as Record<string, string>)[key];
  if (message === undefined) {
    throw new Error(`en.json has no key "${key}"`);
  }
  return new IntlMessageFormat(message, 'en').format(payload?.values ?? {}) as string;
}) as unknown as MessageFormatter;

const memoryNotification = (memoryNotice: Record<string, unknown>, createdAt = '2026-10-03T09:00:00Z') => ({
  createdAt,
  // the server stores the data as JSON text
  data: JSON.stringify({ memoryId: 'memory-1', memoryNotice }) as never,
});

describe('memory notifications (#6)', () => {
  it('words an on this day memory like its card, counting the years from the day it was sent', () => {
    const notification = memoryNotification(
      { type: MemoryType.OnThisDay, data: { year: 2019 }, memoryAt: '2019-10-03T00:00:00.000Z', assetCount: 4 },
      '2026-10-03T09:00:00Z',
    );

    expect(getNotificationText(notification, translate, 'en')).toEqual({
      kind: 'memory',
      title: 'On this day',
      description: '7 years ago',
    });
  });

  it("words a rule's memory from its context, in the viewer's language", () => {
    const notification = memoryNotification({
      type: MemoryType.Rule,
      data: { ruleId: 'trip_anniversary', context: { placeLabel: 'Lisbon', yearsAgo: 3, assetCount: 40, dayCount: 5 } },
    });

    const text = getNotificationText(notification, translate, 'en');

    expect(text?.title).toBe('A trip anniversary');
    expect(text?.description).toContain('Lisbon');
    expect(text?.description).toContain(' · ');
  });

  it('says it is a memory for the other rules, and keeps the old title of a memory made with one', () => {
    const notification = memoryNotification({
      type: MemoryType.Rule,
      data: { ruleId: 'month_recap', title: 'Summer in Crete', context: { year: 2025, month: 8 } },
    });

    expect(getNotificationText(notification, translate, 'en')).toMatchObject({
      title: 'A memory for you',
      description: expect.stringContaining('Summer in Crete'),
    });
  });

  it('words a waiting draft, the trip book as such', () => {
    const data = { bookId: 'book-1', draftNotice: { draftId: 'draft-1', kind: 'trip', title: 'Crete 2026' } };
    expect(getNotificationText({ createdAt: '', data }, translate)).toEqual({
      kind: 'draft',
      title: 'Your trip book is ready',
      description: 'Crete 2026',
    });
    expect(
      getNotificationText({ createdAt: '', data: { ...data, draftNotice: { kind: 'yearly' } } }, translate),
    ).toEqual({ kind: 'draft', title: 'A photo book is waiting for you' });
  });

  it('leaves the other notifications as the server wrote them', () => {
    expect(getNotificationText({ createdAt: '', data: { bookId: 'book-1' } }, translate)).toBeUndefined();
    expect(getNotificationText({ createdAt: '', data: undefined }, translate)).toBeUndefined();
    expect(getMemoryNotice('{"memoryNotice":{"type":"unknown"}}')).toBeUndefined();
    expect(getDraftNotice('not json')).toBeUndefined();
  });

  it('opens the memory, or the book of the draft', () => {
    expect(
      getNotificationRoute({ type: 'Custom' as never, ...memoryNotification({ type: MemoryType.OnThisDay }) }),
    ).toBe('/memories/memory-1');
    expect(
      getNotificationRoute({ type: 'Custom' as never, data: { bookId: 'book-1', draftNotice: { kind: 'trip' } } }),
    ).toBe('/books/book-1');
  });
});

import { faker } from '@faker-js/faker';
import {
  BookDraftKind,
  BookStatus,
  type BookDetailResponseDto,
  type BookDraftResponseDto,
  type BookResponseDto,
  BookStyleTheme,
  type BookUserStyleResponseDto,
} from '@immich/sdk';
import { Sync } from 'factory.ts';

export const bookFactory = Sync.makeFactory<BookResponseDto>({
  id: Sync.each(() => faker.string.uuid()),
  ownerId: Sync.each(() => faker.string.uuid()),
  albumId: null,
  coverAssetId: null,
  title: Sync.each(() => faker.commerce.product()),
  subtitle: null,
  pageWidthMm: 210,
  pageHeightMm: 210,
  style: { marginMm: 10, gutterMm: 4, background: '#ffffff', textColor: '#222222', fontFamily: 'serif' },
  status: BookStatus.Active,
  exportStatus: null,
  htmlExportStatus: null,
  exportedAt: null,
  htmlExportedAt: null,
  exportStale: false,
  htmlExportStale: false,
  pageCount: 0,
  firstPageId: null,
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  updatedAt: Sync.each(() => faker.date.past().toISOString()),
});

export const bookDetailFactory = Sync.makeFactory<BookDetailResponseDto>({
  ...bookFactory.build(),
  id: Sync.each(() => faker.string.uuid()),
  pages: [],
});

export const bookDraftFactory = Sync.makeFactory<BookDraftResponseDto>({
  id: Sync.each(() => faker.string.uuid()),
  key: Sync.each((index) => `food:${2000 + index}`),
  kind: BookDraftKind.Yearly,
  reason: 'You visited 6 restaurants in 2025 and photographed 54 dishes',
  memoryId: null,
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  book: Sync.each(() =>
    bookFactory.build({ status: BookStatus.Draft, pageCount: 24, firstPageId: faker.string.uuid() }),
  ),
});

/** a style of the user's own, e.g. designed with the assistant */
export const bookUserStyleFactory = Sync.makeFactory<BookUserStyleResponseDto>({
  id: Sync.each(() => faker.string.uuid()),
  name: Sync.each((index) => `My style ${index}`),
  description: 'Ivory pages, sage text and a gold accent',
  style: {
    marginMm: 14,
    gutterMm: 5,
    background: '#f7f3e8',
    textColor: '#34402f',
    fontFamily: 'FreeSerif, serif',
    titleSizePt: 30,
    captionSizePt: 10,
    theme: BookStyleTheme.Plain,
    accentColor: '#a8862f',
  },
  createdAt: Sync.each((index) => new Date(Date.UTC(2026, 8, 1 + index)).toISOString()),
  updatedAt: Sync.each((index) => new Date(Date.UTC(2026, 8, 1 + index)).toISOString()),
});

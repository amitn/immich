import { faker } from '@faker-js/faker';
import type { BookDetailResponseDto, BookResponseDto } from '@immich/sdk';
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

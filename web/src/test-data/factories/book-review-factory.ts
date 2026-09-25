import {
  BookStylePreset,
  Severity,
  Type,
  type BookReviewIssueDto,
  type BookReviewResponseDto,
  type BookStylePresetResponseDto,
} from '@immich/sdk';
import { Sync } from 'factory.ts';

/** The presets the server returns */
export const bookStylePresets: BookStylePresetResponseDto[] = [
  {
    id: BookStylePreset.Classic,
    name: 'Classic',
    description: 'White pages',
    style: {
      marginMm: 12,
      gutterMm: 4,
      background: '#ffffff',
      textColor: '#222222',
      fontFamily: 'serif',
      titleSizePt: 28,
      captionSizePt: 10,
    },
  },
  {
    id: BookStylePreset.Soft,
    name: 'Soft',
    description: 'Warm cream pages',
    style: {
      marginMm: 18,
      gutterMm: 5,
      background: '#f6f1e7',
      textColor: '#5b4636',
      fontFamily: 'serif',
      titleSizePt: 28,
      captionSizePt: 10,
    },
  },
  {
    id: BookStylePreset.Bold,
    name: 'Bold',
    description: 'Small margins',
    style: {
      marginMm: 6,
      gutterMm: 2.5,
      background: '#ffffff',
      textColor: '#111111',
      fontFamily: 'sans-serif',
      titleSizePt: 32,
      captionSizePt: 9,
    },
  },
];

export const bookReviewIssueFactory = Sync.makeFactory<BookReviewIssueDto>({
  severity: Severity.Medium,
  type: Type.RepeatedLayout,
  message: 'Pages 4 and 5 use the same layout; use a different one',
  pages: [4, 5],
});

const countIssues = (issues: BookReviewIssueDto[]) => ({
  high: issues.filter((issue) => issue.severity === Severity.High).length,
  medium: issues.filter((issue) => issue.severity === Severity.Medium).length,
  low: issues.filter((issue) => issue.severity === Severity.Low).length,
});

export const buildBookReview = (review: Partial<BookReviewResponseDto> = {}): BookReviewResponseDto => {
  const issues = review.issues ?? [];
  return {
    pageCount: 10,
    counts: countIssues(issues),
    issues,
    unusedPhotos: [],
    weakestPlaced: [],
    people: [],
    ...review,
  };
};

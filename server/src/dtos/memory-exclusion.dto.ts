import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { MemoryExclusionType, MemoryExclusionTypeSchema } from 'src/enum.js';

const day = (description: string) => z.iso.date().describe(description);

const MemoryExclusionCreateSchema = z
  .object({
    type: MemoryExclusionTypeSchema,
    personId: z.uuidv4().optional().describe('With type person: one of your people or pets to leave out'),
    albumId: z.uuidv4().optional().describe('With type album: an album whose photos are left out'),
    startDate: day(
      'With type date_range: the first day left out (YYYY-MM-DD, the local time of the photos)',
    ).optional(),
    endDate: day('With type date_range: the last day left out, included (YYYY-MM-DD)').optional(),
  })
  .refine(
    (dto) =>
      (dto.type === MemoryExclusionType.Person) === (dto.personId !== undefined) &&
      (dto.type === MemoryExclusionType.Album) === (dto.albumId !== undefined) &&
      (dto.type === MemoryExclusionType.DateRange) === (dto.startDate !== undefined && dto.endDate !== undefined) &&
      (dto.type === MemoryExclusionType.DateRange || (dto.startDate === undefined && dto.endDate === undefined)),
    { error: 'Pass personId for a person, albumId for an album, or startDate and endDate for a date range' },
  )
  .refine((dto) => !dto.startDate || !dto.endDate || dto.startDate <= dto.endDate, {
    error: 'The date range ends before it starts',
  })
  .meta({ id: 'MemoryExclusionCreateDto' });

const MemoryExclusionPersonSchema = z
  .object({
    id: z.string().describe('Person ID'),
    name: z.string().describe('Name of the person or pet'),
    isPet: z.boolean().describe('Whether it is a pet'),
  })
  .meta({ id: 'MemoryExclusionPerson' });

const MemoryExclusionAlbumSchema = z
  .object({
    id: z.string().describe('Album ID'),
    albumName: z.string().describe('Album name'),
  })
  .meta({ id: 'MemoryExclusionAlbum' });

const MemoryExclusionResponseSchema = z
  .object({
    id: z.string().describe('Exclusion ID'),
    type: MemoryExclusionTypeSchema,
    person: MemoryExclusionPersonSchema.optional().describe('The person or pet left out'),
    album: MemoryExclusionAlbumSchema.optional().describe('The album left out'),
    startDate: z.string().optional().describe('The first day left out (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('The last day left out, included (YYYY-MM-DD)'),
    createdAt: z.string().meta({ format: 'date-time' }).describe('When it was added'),
  })
  .meta({ id: 'MemoryExclusionResponseDto' });

const MemoryExclusionsResponseSchema = z
  .object({
    exclusions: z.array(MemoryExclusionResponseSchema).describe('The people, albums and days left out'),
    documents: z
      .boolean()
      .describe('Whether screenshots, receipts and documents are left out (the memoryExclusions.documents preference)'),
  })
  .meta({ id: 'MemoryExclusionsResponseDto' });

export class MemoryExclusionCreateDto extends createZodDto(MemoryExclusionCreateSchema) {}
export class MemoryExclusionResponseDto extends createZodDto(MemoryExclusionResponseSchema) {}
export class MemoryExclusionsResponseDto extends createZodDto(MemoryExclusionsResponseSchema) {}

type ExclusionRow = {
  id: string;
  type: MemoryExclusionType;
  personGroupId: string | null;
  albumId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: Date | string;
  personName: string | null;
  personType: string | null;
  albumName: string | null;
};

export const mapMemoryExclusion = (row: ExclusionRow): MemoryExclusionResponseDto => ({
  id: row.id,
  type: row.type,
  ...(row.personGroupId && {
    person: { id: row.personGroupId, name: row.personName ?? '', isPet: row.personType === 'pet' },
  }),
  ...(row.albumId && { album: { id: row.albumId, albumName: row.albumName ?? '' } }),
  ...(row.startDate && { startDate: row.startDate }),
  ...(row.endDate && { endDate: row.endDate }),
  createdAt: new Date(row.createdAt).toISOString(),
});

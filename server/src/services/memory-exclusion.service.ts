import { BadRequestException, Injectable } from '@nestjs/common';
import type { UserMetadataItem } from 'src/types.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  MemoryExclusionCreateDto,
  MemoryExclusionResponseDto,
  MemoryExclusionsResponseDto,
  mapMemoryExclusion,
} from 'src/dtos/memory-exclusion.dto.js';
import { ActivityLogAction, MemoryExclusionType, Permission, UserMetadataKey } from 'src/enum.js';
import { MemoryExclusionRepository } from 'src/repositories/memory-exclusion.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { ActivityMemoryExclusion, ActivityRecorder, quote, recordActivity } from 'src/utils/activity-log.js';
import { MemoryExclusions } from 'src/utils/memory-exclusions.js';
import { getPreferences, getPreferencesPartial, mergePreferences } from 'src/utils/preferences.js';

/** a change of the exclusions: what to add, which exclusions to remove, and the documents switch */
export type MemoryExclusionChange = {
  add?: MemoryExclusionCreateDto[];
  removeIds?: string[];
  documents?: boolean;
};

type ExclusionRow = Awaited<ReturnType<MemoryExclusionRepository['getAll']>>[number];

const describeRow = (row: Pick<ExclusionRow, 'type' | 'personName' | 'albumName' | 'startDate' | 'endDate'>) => {
  switch (row.type) {
    case MemoryExclusionType.Person: {
      return row.personName ? quote(row.personName) : 'a person';
    }
    case MemoryExclusionType.Album: {
      return row.albumName ? `the album ${quote(row.albumName)}` : 'an album';
    }
    case MemoryExclusionType.DateRange: {
      return row.startDate === row.endDate ? `${row.startDate}` : `${row.startDate} to ${row.endDate}`;
    }
  }
};

/** the exclusions the memory engine applies, from a user's rows and preferences */
export const toMemoryExclusions = (
  rows: Array<Pick<ExclusionRow, 'type' | 'personGroupId' | 'albumId' | 'startDate' | 'endDate'>>,
  metadata: UserMetadataItem[],
): MemoryExclusions => ({
  personIds: rows.flatMap((row) =>
    row.type === MemoryExclusionType.Person && row.personGroupId ? [row.personGroupId] : [],
  ),
  albumIds: rows.flatMap((row) => (row.type === MemoryExclusionType.Album && row.albumId ? [row.albumId] : [])),
  dateRanges: rows.flatMap((row) =>
    row.type === MemoryExclusionType.DateRange && row.startDate && row.endDate
      ? [{ from: row.startDate, to: row.endDate }]
      : [],
  ),
  documents: getPreferences(metadata).memoryExclusions.documents,
});

/**
 * What each user keeps out of their memories (#12): people and pets, days and albums (`memory_exclusion`) and, as a
 * preference, screenshots, receipts and documents. The memory engine, the memories it serves, the creations of a
 * memory, the suggested books and the year recap all read them through `getExclusions`.
 */
@Injectable()
export class MemoryExclusionService extends BaseService {
  /** what the memory engine leaves out for a user */
  async getExclusions(userId: string): Promise<MemoryExclusions> {
    const [rows, metadata] = await Promise.all([
      this.memoryExclusionRepository.getAll(userId),
      this.userRepository.getMetadata(userId),
    ]);
    return toMemoryExclusions(rows, metadata ?? []);
  }

  async getAll(auth: AuthDto): Promise<MemoryExclusionsResponseDto> {
    const [rows, metadata] = await Promise.all([
      this.memoryExclusionRepository.getAll(auth.user.id),
      this.userRepository.getMetadata(auth.user.id),
    ]);
    return {
      exclusions: rows.map((row) => mapMemoryExclusion(row)),
      documents: getPreferences(metadata ?? []).memoryExclusions.documents,
    };
  }

  /** Leaves a person, an album or some days out of the memories; adding one that is already there returns it */
  async create(
    auth: AuthDto,
    dto: MemoryExclusionCreateDto,
    activity?: ActivityRecorder,
  ): Promise<MemoryExclusionResponseDto> {
    const { added } = await this.change(auth, { add: [dto] }, activity);
    return added[0];
  }

  /** Lets the photos of an exclusion back into the memories */
  async remove(auth: AuthDto, id: string, activity?: ActivityRecorder): Promise<void> {
    const rows = await this.memoryExclusionRepository.getAll(auth.user.id);
    if (!rows.some((row) => row.id === id)) {
      throw new BadRequestException('Memory exclusion not found');
    }
    await this.change(auth, { removeIds: [id] }, activity);
  }

  /**
   * Adds and removes exclusions and sets the documents switch, as one change of the activity log (undoing it puts
   * every exclusion back as it was)
   */
  async change(auth: AuthDto, change: MemoryExclusionChange, activity?: ActivityRecorder) {
    const userId = auth.user.id;
    const before = await this.memoryExclusionRepository.getAll(userId);

    // checked before anything changes, so that a bad id changes nothing
    const add = change.add ?? [];
    const personIds = add.flatMap((dto) => (dto.personId ? [dto.personId] : []));
    const albumIds = add.flatMap((dto) => (dto.albumId ? [dto.albumId] : []));
    if (personIds.length > 0) {
      const owned = await this.accessRepository.person.checkOwnerAccess(userId, new Set(personIds));
      const missing = personIds.filter((id) => !owned.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Not one of your people or pets: ${missing.join(', ')}`);
      }
    }
    if (albumIds.length > 0) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: albumIds });
    }
    const removeIds = [...new Set(change.removeIds ?? [])];
    const unknown = removeIds.filter((id) => !before.some((row) => row.id === id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Memory exclusion not found: ${unknown.join(', ')}`);
    }

    const addedIds: string[] = [];
    for (const dto of add) {
      const existing = before.find(
        (row) =>
          row.type === dto.type &&
          ((dto.personId && row.personGroupId === dto.personId) ||
            (dto.albumId && row.albumId === dto.albumId) ||
            (dto.startDate && row.startDate === dto.startDate && row.endDate === dto.endDate)),
      );
      if (existing && !removeIds.includes(existing.id)) {
        continue;
      }
      const created = await this.memoryExclusionRepository.create({
        ownerId: userId,
        type: dto.type,
        personGroupId: dto.personId ?? null,
        albumId: dto.albumId ?? null,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
      });
      if (created) {
        addedIds.push(created.id);
      }
    }

    const removed = await this.memoryExclusionRepository.delete(userId, removeIds);

    let previousDocuments: boolean | undefined;
    if (change.documents !== undefined) {
      const metadata = await this.userRepository.getMetadata(userId);
      const preferences = getPreferences(metadata ?? []);
      if (preferences.memoryExclusions.documents !== change.documents) {
        previousDocuments = preferences.memoryExclusions.documents;
        await this.setDocuments(userId, change.documents);
      }
    }

    const after = await this.memoryExclusionRepository.getAll(userId);
    const added = add.map((dto) => {
      const row = after.find(
        (row) =>
          row.type === dto.type &&
          ((dto.personId && row.personGroupId === dto.personId) ||
            (dto.albumId && row.albumId === dto.albumId) ||
            (dto.startDate && row.startDate === dto.startDate && row.endDate === dto.endDate)),
      );
      if (!row) {
        throw new BadRequestException('Unable to add the memory exclusion');
      }
      return mapMemoryExclusion(row);
    });

    if (addedIds.length > 0 || removed.length > 0 || previousDocuments !== undefined) {
      const parts = [
        ...after.filter((row) => addedIds.includes(row.id)).map((row) => `left ${describeRow(row)} out`),
        ...before.filter((row) => removed.some(({ id }) => id === row.id)).map((row) => `let ${describeRow(row)} back`),
        ...(previousDocuments === undefined
          ? []
          : [change.documents ? 'left screenshots, receipts and documents out' : 'let documents back']),
      ];
      await recordActivity({ repository: this.activityLogRepository, logger: this.logger }, userId, activity, {
        action: ActivityLogAction.MemoryExclusionChange,
        summary: `Memories: ${parts.join(', ')}`,
        undo: {
          addedIds,
          removed: removed.map((row): ActivityMemoryExclusion => ({
            type: row.type,
            personGroupId: row.personGroupId,
            albumId: row.albumId,
            startDate: row.startDate,
            endDate: row.endDate,
          })),
          ...(previousDocuments !== undefined && { previousDocuments }),
        },
      });
    }

    return { added, removedIds: removed.map(({ id }) => id), exclusions: after.map((row) => mapMemoryExclusion(row)) };
  }

  /** puts the exclusions back as they were before a change (the undo of `MemoryExclusionChange`) */
  async revert(
    userId: string,
    {
      addedIds,
      removed,
      previousDocuments,
    }: { addedIds: string[]; removed: ActivityMemoryExclusion[]; previousDocuments?: boolean },
  ) {
    await this.memoryExclusionRepository.delete(userId, addedIds);
    for (const row of removed) {
      await this.memoryExclusionRepository.create({ ownerId: userId, ...row });
    }
    if (previousDocuments !== undefined) {
      await this.setDocuments(userId, previousDocuments);
    }
  }

  private async setDocuments(userId: string, documents: boolean) {
    const metadata = await this.userRepository.getMetadata(userId);
    const updated = mergePreferences(getPreferences(metadata ?? []), { memoryExclusions: { documents } });
    await this.userRepository.upsertMetadata(userId, {
      key: UserMetadataKey.Preferences,
      value: getPreferencesPartial(updated),
    });
  }
}

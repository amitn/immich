import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  type Timestamp,
} from '@immich/sql-tools';
import { MemoryExclusionType } from 'src/enum.js';
import { AlbumTable } from 'src/schema/tables/album.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
 * What a user keeps out of their memories and of everything made from them (#12): the photos of a person or a pet
 * (and, through the person's face identity, the photos of them in shared spaces), the photos taken in a range of days,
 * and the photos of an album. Every rule of the memory engine, the memories already made, the videos, books and
 * collages of a memory, the suggested books and the year recap leave them out. "No screenshots, receipts or
 * documents" is a preference (`memoryExclusions.documents`), not a row.
 */
@Table('memory_exclusion')
@Check({
  name: 'memory_exclusion_kind_chk',
  expression:
    `("type" = 'person' AND "personGroupId" IS NOT NULL AND "albumId" IS NULL AND "startDate" IS NULL) OR ` +
    `("type" = 'album' AND "albumId" IS NOT NULL AND "personGroupId" IS NULL AND "startDate" IS NULL) OR ` +
    `("type" = 'date_range' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "startDate" <= "endDate" ` +
    `AND "personGroupId" IS NULL AND "albumId" IS NULL)`,
})
@Index({
  name: 'memory_exclusion_ownerId_personGroupId_key',
  columns: ['ownerId', 'personGroupId'],
  unique: true,
  where: '"personGroupId" IS NOT NULL',
})
@Index({
  name: 'memory_exclusion_ownerId_albumId_key',
  columns: ['ownerId', 'albumId'],
  unique: true,
  where: '"albumId" IS NOT NULL',
})
export class MemoryExclusionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @Column()
  type!: MemoryExclusionType;

  /** the person or pet left out (the user's own, by its person group) */
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: true, index: false })
  personGroupId!: string | null;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: true, index: false })
  albumId!: string | null;

  /** the first and last day left out, in the local time of the photos; both included */
  @Column({ type: 'date', nullable: true })
  startDate!: Timestamp | null;

  @Column({ type: 'date', nullable: true })
  endDate!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

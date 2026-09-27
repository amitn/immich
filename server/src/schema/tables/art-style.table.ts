import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** an artistic style the user designed (e.g. with the assistant), shown next to the built-in styles */
@Table('art_style')
@UpdatedAtTrigger('art_style_updatedAt')
export class ArtStyleTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  ownerId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: Generated<string>;

  /** image-generation prompt; `{caption}` is replaced with the caption when `usesCaption` */
  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'boolean', default: false })
  usesCaption!: Generated<boolean>;

  /** the art agent only paints the lower half, and the untouched photo is placed above it */
  @Column({ type: 'boolean', default: false })
  photoAbove!: Generated<boolean>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn()
  updateId!: Generated<string>;
}

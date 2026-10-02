import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { ParkingSpot } from './parking-spot.entity';

// 可共享时段（某一具体日期的可出租区间，夜间场景按晚发布）
@Entity('share_slots')
@Index(['spot', 'date'])
export class ShareSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ParkingSpot, (s) => s.slots, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  // 共享日期，如 2026-10-01
  @Column({ type: 'date' })
  date: string;

  // 可共享起止时间（分钟数，0-1439），如 19:00=1140, 08:00 次日=1920（允许跨午夜）
  @Column({ type: 'int' })
  startMinute: number;

  @Column({ type: 'int' })
  endMinute: number;

  // 业主承诺不回家的时间保证（取消需承担违约补偿）
  @Column({ default: true })
  guaranteed: boolean;

  // 业主实际回家时间（ISO 字符串），为空表示未提前回家
  @Column({ type: 'timestamptz', nullable: true })
  ownerReturnedAt: Date | null;

  @Column({ default: false })
  closed: boolean;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { ParkingSpot } from './parking-spot.entity';
import { User } from './user.entity';

// 物业巡查记录（申诉证据来源之一）
@Entity('patrol_records')
@Index(['spot', 'at'])
export class PatrolRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inspector_id' })
  inspector: User | null;

  // 现场车牌（无车可为 null）
  @Column({ type: 'varchar', length: 16, nullable: true })
  plate: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz' })
  at: Date;

  @CreateDateColumn()
  createdAt: Date;
}

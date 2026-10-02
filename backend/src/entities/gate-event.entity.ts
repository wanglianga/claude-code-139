import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { GATE_MATCH_TYPES, GateMatchType } from '../common/enums';
import { ParkingSession } from './parking-session.entity';
import { ParkingSpot } from './parking-spot.entity';

export type GateDirection = 'in' | 'out';

// 道闸日志：每次识别/抬杆/人工放行都留痕，作为申诉证据
@Entity('gate_events')
@Index(['occurredAt'])
export class GateEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 4 })
  direction: GateDirection;

  @Column({ type: 'varchar', length: 16, nullable: true })
  recognizedPlate: string | null;

  // 识别置信度 0-1
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 1,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  confidence: number;

  @Column({ type: 'enum', enum: GATE_MATCH_TYPES })
  matchType: GateMatchType;

  @Column({ default: false })
  barrierOpened: boolean;

  // 人工放行操作员（物业用户 id）
  @Column({ type: 'uuid', nullable: true })
  manualOperatorId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @ManyToOne(() => ParkingSession, (s) => s.gateEvents, {
    nullable: true,
    eager: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'session_id' })
  session: ParkingSession | null;

  @ManyToOne(() => ParkingSpot, { nullable: true, eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot | null;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import {
  APPEAL_STATUSES,
  AppealStatus,
  RESPONSIBILITIES,
  Responsibility,
} from '../common/enums';
import { numericColumn } from '../common/decimal';
import { User } from './user.entity';
import { ParkingSpot } from './parking-spot.entity';
import { Reservation } from './reservation.entity';
import { AppealEvidence } from './appeal-evidence.entity';

// 错停申诉：综合车牌识别、预约、现场照片、道闸日志、业主回家时间、物业巡查判断责任
@Entity('appeals')
@Index(['status'])
export class Appeal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (u) => u.appeals, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appellant_id' })
  appellant: User;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  @ManyToOne(() => Reservation, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation | null;

  @Column({ length: 16 })
  plate: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'enum', enum: APPEAL_STATUSES, default: 'pending' })
  status: AppealStatus;

  // 责任判定
  @Column({ type: 'enum', enum: RESPONSIBILITIES, default: 'none' })
  responsibility: Responsibility;

  // 责任比例（车主承担比例 0-1），partial 时为 0~1
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 0,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  driverShare: number;

  // 判定推理链（每条证据如何被采纳）
  @Column({ type: 'jsonb', nullable: true })
  findings: Record<string, any> | null;

  // 费用处置
  @Column({ ...numericColumn })
  overtimeFee: number;

  @Column({ ...numericColumn })
  moveDelayPenalty: number;

  @Column({ ...numericColumn })
  ownerCompensation: number;

  @Column({ ...numericColumn })
  refundAmount: number;

  // 是否影响信用
  @Column({ default: false })
  creditImpact: boolean;

  @Column({ type: 'int', default: 0 })
  creditDelta: number;

  @Column({ type: 'text', nullable: true })
  adjudicatorNote: string | null;

  @Column({ type: 'uuid', nullable: true })
  adjudicatorId: string | null;

  @OneToMany(() => AppealEvidence, (e) => e.appeal, { cascade: true })
  evidences: AppealEvidence[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  adjudicatedAt: Date | null;
}

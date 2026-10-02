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
import { INCIDENT_STATUSES, INCIDENT_TYPES, IncidentStatus, IncidentType } from '../common/enums';
import { ParkingSpot } from './parking-spot.entity';
import { Reservation } from './reservation.entity';
import { ParkingSession } from './parking-session.entity';
import { User } from './user.entity';
import { MoveNotice } from './move-notice.entity';
import { Reservation as _R } from './reservation.entity';

// 夜间异常事件
@Entity('incidents')
@Index(['type', 'status'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: INCIDENT_TYPES })
  type: IncidentType;

  @Column({ type: 'enum', enum: INCIDENT_STATUSES, default: 'open' })
  status: IncidentStatus;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  @ManyToOne(() => Reservation, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation | null;

  @ManyToOne(() => ParkingSession, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'session_id' })
  session: ParkingSession | null;

  // 涉事车牌（如陌生占位车、燃油车）
  @Column({ type: 'varchar', length: 16, nullable: true })
  involvedPlate: string | null;

  // 上报人
  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reported_by_id' })
  reportedBy: User | null;

  @Column({ type: 'text' })
  description: string;

  // 夜间调度处置记录（改派车位、清退、现场疏导等）
  @Column({ type: 'jsonb', nullable: true })
  resolution: Record<string, any> | null;

  @OneToMany(() => MoveNotice, (m) => m.incident)
  moveNotices: MoveNotice[];

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

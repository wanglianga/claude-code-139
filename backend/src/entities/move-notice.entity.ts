import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { MOVE_NOTICE_STATUSES, MoveNoticeStatus } from '../common/enums';
import { Incident } from './incident.entity';

// 挪车通知：通知时间、确认、挪车完成时间，用于计算是否超时及超时费
@Entity('move_notices')
export class MoveNotice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 16 })
  plate: string;

  @ManyToOne(() => Incident, (i) => i.moveNotices, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column({ type: 'enum', enum: MOVE_NOTICE_STATUSES, default: 'sent' })
  status: MoveNoticeStatus;

  @Column({ type: 'timestamptz' })
  sentAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  movedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  channel: string | null; // 短信/App推送/电话

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Appeal } from './appeal.entity';

export type EvidenceKind =
  | 'anpr' // 车牌识别抓拍
  | 'site_photo' // 现场照片
  | 'nav_screen' // 车机导航截图
  | 'gate_log' // 道闸日志
  | 'owner_return' // 业主回家记录
  | 'patrol' // 物业巡查记录
  | 'reservation' // 预约记录
  | 'other';

// 申诉证据（多源材料）
@Entity('appeal_evidences')
export class AppealEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Appeal, (a) => a.evidences, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appeal_id' })
  appeal: Appeal;

  @Column({ type: 'varchar', length: 24 })
  kind: EvidenceKind;

  @Column({ type: 'text' })
  content: string;

  // 现场照片可携带结构化定位（便于责任引擎交叉核验）
  @Column({ type: 'varchar', length: 32, nullable: true })
  spotCode: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  plate: string | null;

  // 证据指向的时间点
  @Column({ type: 'timestamptz', nullable: true })
  occurredAt: Date | null;

  // 是否支持申诉（true=对车主有利，false=不利）
  @Column({ type: 'boolean', nullable: true })
  favorsAppellant: boolean | null;

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

export type AuditActorKind = 'owner' | 'driver' | 'property' | 'admin' | 'system';

// 全链路追溯日志：车位发布、预约、入场、异常、离场、分账统一留痕
@Entity('audit_logs')
@Index(['refType', 'refId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  actorKind: AuditActorKind;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ length: 64 })
  action: string;

  // 关联资源（spot/reservation/session/incident/appeal/order/settlement）
  @Column({ length: 32 })
  refType: string;

  @Column({ type: 'uuid', nullable: true })
  refId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any> | null;

  @CreateDateColumn()
  at: Date;
}

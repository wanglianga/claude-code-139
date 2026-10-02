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
import { SETTLEMENT_STATUSES, SettlementStatus } from '../common/enums';
import { numericColumn } from '../common/decimal';
import { Community } from './community.entity';
import { SettlementItem } from './settlement-item.entity';
import { Order } from './order.entity';

// 分账批次：按小区 + 夜间日期合并清算（业主收益/物业服务费/平台抽成/优惠券/退款/异常补偿）
@Entity('settlements')
@Index(['community', 'date'], { unique: true })
export class Settlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Community, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_id' })
  community: Community;

  // 夜间日期（共享日期）
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: SETTLEMENT_STATUSES, default: 'draft' })
  status: SettlementStatus;

  // 汇总
  @Column({ ...numericColumn })
  totalCollected: number; // 车主实付合计

  @Column({ ...numericColumn })
  totalRefund: number; // 退款合计

  @Column({ ...numericColumn })
  totalCoupon: number; // 优惠券抵扣合计

  @Column({ ...numericColumn })
  totalCompensation: number; // 异常补偿合计

  @Column({ ...numericColumn })
  ownerPayout: number; // 业主应得合计

  @Column({ ...numericColumn })
  propertyFee: number; // 物业服务费合计

  @Column({ ...numericColumn })
  platformFee: number; // 平台抽成合计

  @Column({ type: 'jsonb', nullable: true })
  breakdown: Record<string, any> | null;

  @OneToMany(() => SettlementItem, (i) => i.settlement, { cascade: true })
  items: SettlementItem[];

  @OneToMany(() => Order, (o) => o.settlement)
  orders: Order[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;
}

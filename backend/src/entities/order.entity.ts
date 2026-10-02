import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { ORDER_STATUSES, OrderStatus } from '../common/enums';
import { numericColumn } from '../common/decimal';
import { Reservation } from './reservation.entity';
import { ParkingSession } from './parking-session.entity';
import { Settlement } from './settlement.entity';
import { Incident } from './incident.entity';
import { Appeal } from './appeal.entity';
import { ParkingSpot } from './parking-spot.entity';

// 订单：一笔停车服务的计费结果（可能含陌生占位车的惩罚单）
@Entity('orders')
@Index(['settlement'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 16 })
  plate: string;

  @Column({ type: 'varchar', length: 24, default: 'parking' })
  kind: 'parking' | 'stranger_penalty';

  @Column({ type: 'enum', enum: ORDER_STATUSES, default: 'unpaid' })
  status: OrderStatus;

  @ManyToOne(() => Reservation, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation | null;

  @ManyToOne(() => ParkingSession, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'session_id' })
  session: ParkingSession | null;

  @ManyToOne(() => Incident, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident | null;

  @ManyToOne(() => Appeal, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'appeal_id' })
  appeal: Appeal | null;

  // 费用分项
  @Column({ ...numericColumn })
  baseFee: number; // 基础停车费（按实际占用时段）

  @Column({ ...numericColumn })
  overtimeFee: number; // 超时费

  @Column({ ...numericColumn })
  moveDelayPenalty: number; // 挪车迟延违约金

  @Column({ ...numericColumn })
  strangerPenalty: number; // 陌生占位违约金

  @Column({ ...numericColumn })
  couponDiscount: number; // 优惠券抵扣

  @Column({ ...numericColumn })
  abnormalCompensation: number; // 异常补偿（平台/物业/业主方赔给车主）

  @Column({ ...numericColumn })
  ownerCompensation: number; // 车主赔给业主（错停）

  // 责任快照（结算/分账依据）
  @Column({ type: 'varchar', length: 24, default: 'none' })
  responsibility: string;

  // 车主应付 = base + overtime + penalties - coupon - compensation
  @Column({ ...numericColumn })
  payable: number;

  // 已付（离场结算时模拟支付）
  @Column({ ...numericColumn })
  paid: number;

  // 退款
  @Column({ ...numericColumn })
  refund: number;

  // 本单使用的优惠券
  @Column({ type: 'uuid', nullable: true })
  couponId: string | null;

  // 无预约订单（陌生占位追缴单）直接挂车位
  @ManyToOne(() => ParkingSpot, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot | null;

  // 申诉裁决后少缴追缴
  @Column({ ...numericColumn })
  extraCharges: number;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @ManyToOne(() => Settlement, (s) => s.orders, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'settlement_id' })
  settlement: Settlement | null;

  @CreateDateColumn()
  createdAt: Date;
}

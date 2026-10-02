import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { Responsibility, RESPONSIBILITIES } from '../common/enums';
import { numericColumn } from '../common/decimal';
import { Settlement } from './settlement.entity';
import { Order } from './order.entity';
import { Reservation } from './reservation.entity';
import { ParkingSpot } from './parking-spot.entity';
import { User } from './user.entity';

// 分账明细：同一晚同一车位的每一段时间由谁使用、谁支付、谁承担违约
@Entity('settlement_items')
@Index(['settlement', 'spot', 'segmentStart'])
export class SettlementItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Settlement, (s) => s.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'settlement_id' })
  settlement: Settlement;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  @ManyToOne(() => Reservation, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation | null;

  @ManyToOne(() => Order, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'driver_id' })
  driver: User | null;

  @Column({ length: 16 })
  plate: string;

  // 该笔占用覆盖的时间段（解释用）
  @Column({ type: 'timestamptz' })
  segmentStart: Date;

  @Column({ type: 'timestamptz' })
  segmentEnd: Date;

  @Column({ ...numericColumn })
  ownerAmount: number;

  @Column({ ...numericColumn })
  propertyAmount: number;

  @Column({ ...numericColumn })
  platformAmount: number;

  @Column({ ...numericColumn })
  couponAmount: number;

  @Column({ ...numericColumn })
  refundAmount: number;

  @Column({ ...numericColumn })
  compensationAmount: number;

  // 该时间段违约责任归属
  @Column({ type: 'enum', enum: RESPONSIBILITIES, default: 'none' })
  responsibility: Responsibility;

  // 车主对该段实际支付
  @Column({ ...numericColumn })
  paidByDriver: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}

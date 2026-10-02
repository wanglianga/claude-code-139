import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { RESERVATION_STATUSES, ReservationStatus, VehicleType } from '../common/enums';
import { numericColumn } from '../common/decimal';
import { ParkingSpot } from './parking-spot.entity';
import { ShareSlot } from './share-slot.entity';
import { User } from './user.entity';
import { ParkingSession } from './parking-session.entity';
import { Order } from './order.entity';

@Entity('reservations')
@Index(['slot'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 16 })
  plate: string;

  @Column({ type: 'varchar', length: 8, default: 'ev' })
  vehicleType: VehicleType;

  @Column({ default: false })
  isVisitor: boolean;

  @ManyToOne(() => User, (u) => u.reservations, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spot_id' })
  spot: ParkingSpot;

  @ManyToOne(() => ShareSlot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ShareSlot;

  // 预约占用起止（绝对时间）
  @Column({ type: 'timestamptz' })
  startTime: Date;

  @Column({ type: 'timestamptz' })
  endTime: Date;

  @Column({ type: 'enum', enum: RESERVATION_STATUSES, default: 'booked' })
  status: ReservationStatus;

  // 夜间调度：被改派后的新预约（显式加载，避免自关联 eager 链冲突）
  @ManyToOne(() => Reservation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dispatched_to_id' })
  dispatchedTo: Reservation | null;

  // 改派/清退原因说明
  @Column({ type: 'text', nullable: true })
  dispatchNote: string | null;

  // 预估费用
  @Column({ ...numericColumn })
  estimatedFee: number;

  @OneToOne(() => ParkingSession, (s) => s.reservation)
  session: ParkingSession;

  @OneToMany(() => Order, (o) => o.reservation)
  orders: Order[];

  @CreateDateColumn()
  createdAt: Date;
}

import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import {
  GATE_MATCH_TYPES,
  GateMatchType,
  SESSION_STATUSES,
  SessionStatus,
} from '../common/enums';
import { numericColumn } from '../common/decimal';
import { ParkingSpot } from './parking-spot.entity';
import { Reservation } from './reservation.entity';
import { GateEvent } from './gate-event.entity';
import { Order } from './order.entity';

// 停车服务会话：入场道闸、车牌识别、导航引导、计费、离场结算绑定同一笔
@Entity('parking_sessions')
export class ParkingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Reservation, (r) => r.session, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation;

  @ManyToOne(() => ParkingSpot, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actual_spot_id' })
  actualSpot: ParkingSpot;

  @Column({ length: 16 })
  plate: string;

  @Column({ type: 'timestamptz' })
  entryTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  exitTime: Date | null;

  @Column({ type: 'enum', enum: SESSION_STATUSES, default: 'in' })
  status: SessionStatus;

  // 入场识别方式
  @Column({ type: 'enum', enum: GATE_MATCH_TYPES, default: 'matched' })
  entryMatchType: GateMatchType;

  @Column({ type: 'enum', enum: GATE_MATCH_TYPES, nullable: true })
  exitMatchType: GateMatchType | null;

  // 下发的导航引导
  @Column({ type: 'varchar', length: 200, default: '' })
  navigationRoute: string;

  // 计费明细快照（离场结算时固化）
  @Column({ type: 'jsonb', nullable: true })
  billing: Record<string, any> | null;

  @OneToMany(() => GateEvent, (g) => g.session)
  gateEvents: GateEvent[];

  @OneToMany(() => Order, (o) => o.session)
  orders: Order[];
}

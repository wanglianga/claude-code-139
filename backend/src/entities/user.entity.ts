import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { USER_ROLES, UserRole } from '../common/enums';
import { ParkingSpot } from './parking-spot.entity';
import { Reservation } from './reservation.entity';
import { Appeal } from './appeal.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column()
  displayName: string;

  @Column({ type: 'varchar', length: 16 })
  phone: string;

  @Column({ type: 'enum', enum: USER_ROLES })
  role: UserRole;

  // 车主信用分：初始 100，错停/超时扣减，影响后续预约资格
  @Column({ type: 'int', default: 100 })
  creditScore: number;

  // 车主绑定的常用车牌（逗号分隔，便于演示）
  @Column({ type: 'varchar', length: 200, default: '' })
  plates: string;

  @Column({ default: true })
  isMonthlyTenant: boolean;

  @OneToMany(() => ParkingSpot, (s) => s.owner)
  spots: ParkingSpot[];

  @OneToMany(() => Reservation, (r) => r.driver)
  reservations: Reservation[];

  @OneToMany(() => Appeal, (a) => a.appellant)
  appeals: Appeal[];

  @CreateDateColumn()
  createdAt: Date;
}

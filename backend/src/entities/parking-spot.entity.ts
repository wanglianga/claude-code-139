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
import {
  MONTHLY_PRIORITIES,
  MonthlyPriority,
  SPOT_APPROVALS,
  SpotApproval,
  VehicleType,
} from '../common/enums';
import { numericColumn } from '../common/decimal';
import { Community } from './community.entity';
import { User } from './user.entity';
import { ShareSlot } from './share-slot.entity';

@Entity('parking_spots')
@Index(['community', 'code'], { unique: true })
export class ParkingSpot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 车位编号，如 B2-A-018
  @Column({ length: 32 })
  code: string;

  @Column({ length: 64, default: '地下车库' })
  zone: string;

  // 产权登记：产权证号/车位产权证明编号
  @Column({ length: 64 })
  deedNo: string;

  @ManyToOne(() => Community, (c) => c.spots, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_id' })
  community: Community;

  @ManyToOne(() => User, (u) => u.spots, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  // 是否靠近充电桩
  @Column({ default: false })
  nearCharger: boolean;

  // 是否为充电车位（被燃油车占用即异常）
  @Column({ default: false })
  isChargerSpot: boolean;

  // 是否允许访客车辆
  @Column({ default: true })
  allowVisitor: boolean;

  // 月租车优先规则
  @Column({ type: 'enum', enum: MONTHLY_PRIORITIES, default: 'none' })
  monthlyPriority: MonthlyPriority;

  // 物业审核状态
  @Column({ type: 'enum', enum: SPOT_APPROVALS, default: 'pending' })
  approvalStatus: SpotApproval;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  // 导航引导：泊位坐标/导航描述
  @Column({ length: 200, default: '' })
  navigationHint: string;

  // 自定义每小时单价（为空时取小区价）
  @Column({ ...numericColumn, nullable: true })
  hourlyRateOverride: number | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => ShareSlot, (s) => s.spot)
  slots: ShareSlot[];

  @CreateDateColumn()
  createdAt: Date;
}

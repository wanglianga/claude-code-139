import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ParkingSpot } from './parking-spot.entity';

// 小区/物业项目
@Entity('communities')
export class Community {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  address: string;

  // 平台抽成比例（对停车费毛收入）
  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.12,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  platformRate: number;

  // 物业服务费比例
  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.08,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  propertyRate: number;

  // 每小时单价（元），可被车位自定义价覆盖
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 6,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  hourlyRate: number;

  // 夜间封顶价（元）
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 30,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  nightlyCap: number;

  // 超时费率倍数（如 1.5 倍）
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 1.5,
    transformer: { from: (v: string) => parseFloat(v), to: (v: number) => v } })
  overtimeMultiplier: number;

  // 挪车宽限分钟数（通知后免费挪车时间）
  @Column({ type: 'int', default: 15 })
  moveGraceMinutes: number;

  @OneToMany(() => ParkingSpot, (s) => s.community)
  spots: ParkingSpot[];

  @CreateDateColumn()
  createdAt: Date;
}

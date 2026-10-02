import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Community } from './entities/community.entity';
import { ParkingSpot } from './entities/parking-spot.entity';
import { ShareSlot } from './entities/share-slot.entity';
import { Coupon } from './entities/coupon.entity';
import { AuditLog } from './entities/audit-log.entity';

export const SEED_ENTITIES = [
  User, Community, ParkingSpot, ShareSlot, Coupon, AuditLog,
];

// 幂等种子：重建用户/小区/车位/时段/优惠券演示数据
export async function runSeed(ds: DataSource) {
  await ds.query(
    'TRUNCATE TABLE users, communities, parking_spots, share_slots, coupons RESTART IDENTITY CASCADE',
  );

  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const users = ds.getRepository(User);
  const communities = ds.getRepository(Community);
  const spots = ds.getRepository(ParkingSpot);
  const slots = ds.getRepository(ShareSlot);
  const coupons = ds.getRepository(Coupon);
  const audit = ds.getRepository(AuditLog);

  const owner = await users.save(
    users.create({
      username: 'owner', passwordHash: hash('owner123'), displayName: '业主·王建国',
      phone: '13800000001', role: 'owner', creditScore: 100, isMonthlyTenant: true,
    }),
  );
  const driver = await users.save(
    users.create({
      username: 'driver', passwordHash: hash('driver123'), displayName: '外来车主·李晓',
      phone: '13800000002', role: 'driver', creditScore: 100, plates: '京A12345',
      isMonthlyTenant: true,
    }),
  );
  await users.save(
    users.create({
      username: 'driver2', passwordHash: hash('driver123'), displayName: '访客车主·赵访客',
      phone: '13800000003', role: 'driver', creditScore: 92, plates: '京V88888',
      isMonthlyTenant: false,
    }),
  );
  await users.save(
    users.create({
      username: 'driver3', passwordHash: hash('driver123'), displayName: '外来车主·陈晨',
      phone: '13800000006', role: 'driver', creditScore: 100, plates: '京C66666',
      isMonthlyTenant: true,
    }),
  );
  await users.save(
    users.create({
      username: 'driver4', passwordHash: hash('driver123'), displayName: '外来车主·孙导航',
      phone: '13800000007', role: 'driver', creditScore: 100, plates: '京D77777',
      isMonthlyTenant: true,
    }),
  );
  await users.save(
    users.create({
      username: 'property', passwordHash: hash('property123'), displayName: '物业管家·张敏',
      phone: '13800000004', role: 'property', creditScore: 100,
    }),
  );
  await users.save(
    users.create({
      username: 'admin', passwordHash: hash('admin123'), displayName: '平台管理员',
      phone: '13800000005', role: 'admin', creditScore: 100,
    }),
  );

  const community = await communities.save(
    communities.create({
      name: '朝阳景苑',
      address: '北京市朝阳区宜居路 88 号',
      platformRate: 0.12,
      propertyRate: 0.08,
      hourlyRate: 6,
      nightlyCap: 30,
      overtimeMultiplier: 1.5,
      moveGraceMinutes: 15,
    }),
  );

  const mkSpot = (code: string, zone: string, deed: string, extra: Partial<ParkingSpot>) =>
    spots.save(
      spots.create({
        code, zone, deedNo: deed, community, owner,
        nearCharger: false, isChargerSpot: false, allowVisitor: true,
        monthlyPriority: 'none', approvalStatus: 'approved', active: true,
        navigationHint: '', hourlyRateOverride: null, ...extra,
      }),
    );

  const spotA = await mkSpot('B2-A-018', '地下二层 A 区', '京(2024)朝字第0018号', {
    nearCharger: true, monthlyPriority: 'monthly_first',
    navigationHint: 'A 区直行到底左转，靠立柱 18 号',
  });
  const spotB = await mkSpot('B2-B-026', '地下二层 B 区（充电区）', '京(2024)朝字第026号', {
    isChargerSpot: true, nearCharger: true, allowVisitor: false,
    navigationHint: '充电区 26 号桩，插枪后扫码启动',
  });
  const spotC = await mkSpot('B2-C-030', '地下二层 C 区', '京(2024)朝字第030号', {});

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const date of [today, tomorrow]) {
    await slots.save([
      slots.create({ spot: spotA, date, startMinute: 19 * 60, endMinute: 33 * 60, guaranteed: true }),
      slots.create({ spot: spotB, date, startMinute: 19 * 60, endMinute: 33 * 60, guaranteed: true }),
      slots.create({ spot: spotC, date, startMinute: 19 * 60, endMinute: 33 * 60, guaranteed: false }),
    ]);
  }

  await coupons.save(
    coupons.create({
      code: 'NIGHT10', owner: driver, amount: 10, used: false,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    }),
  );

  await audit.save(
    audit.create({
      actorKind: 'system', actorId: null, action: 'seed',
      refType: 'system', refId: null,
      payload: { accounts: ['owner', 'driver', 'driver2', 'driver3', 'driver4', 'property', 'admin'] },
    }),
  );

  // eslint-disable-next-line no-console
  console.log('Seed done. 今晚共享日期 =', today);
}

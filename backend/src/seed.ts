import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { runSeed, SEED_ENTITIES } from './seed-data';
import { User } from './entities/user.entity';
import { Community } from './entities/community.entity';
import { ParkingSpot } from './entities/parking-spot.entity';
import { ShareSlot } from './entities/share-slot.entity';
import { Coupon } from './entities/coupon.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Reservation } from './entities/reservation.entity';
import { ParkingSession } from './entities/parking-session.entity';
import { GateEvent } from './entities/gate-event.entity';
import { Incident } from './entities/incident.entity';
import { MoveNotice } from './entities/move-notice.entity';
import { Appeal } from './entities/appeal.entity';
import { AppealEvidence } from './entities/appeal-evidence.entity';
import { Order } from './entities/order.entity';
import { Settlement } from './entities/settlement.entity';
import { SettlementItem } from './entities/settlement-item.entity';
import { PatrolRecord } from './entities/patrol-record.entity';

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'parking',
    password: process.env.DB_PASSWORD || 'parking',
    database: process.env.DB_NAME || 'shared_parking',
    entities: [
      User, Community, ParkingSpot, ShareSlot, Coupon, AuditLog, Reservation,
      ParkingSession, GateEvent, Incident, MoveNotice, Appeal, AppealEvidence,
      Order, Settlement, SettlementItem, PatrolRecord,
    ],
    synchronize: true,
    logging: false,
  });
  await ds.initialize();
  await runSeed(ds);
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

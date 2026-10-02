import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from '../../entities/community.entity';
import { ParkingSpot } from '../../entities/parking-spot.entity';
import { ShareSlot } from '../../entities/share-slot.entity';
import { Reservation } from '../../entities/reservation.entity';
import { ParkingSession } from '../../entities/parking-session.entity';
import { GateEvent } from '../../entities/gate-event.entity';
import { Incident } from '../../entities/incident.entity';
import { MoveNotice } from '../../entities/move-notice.entity';
import { PatrolRecord } from '../../entities/patrol-record.entity';
import { Coupon } from '../../entities/coupon.entity';
import { Appeal } from '../../entities/appeal.entity';
import { AppealEvidence } from '../../entities/appeal-evidence.entity';
import { Order } from '../../entities/order.entity';
import { Settlement } from '../../entities/settlement.entity';
import { SettlementItem } from '../../entities/settlement-item.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { User } from '../../entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { ParkingService } from './parking.service';
import { AppealService } from './appeal.service';
import { SettlementService } from './settlement.service';
import { AuditService } from './audit.service';
import { ParkingController } from './parking.controller';
import { AppealController } from './appeal.controller';
import { SettlementController, TraceController } from './settlement.controller';
import { AuditController } from './audit.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Community,
      ParkingSpot,
      ShareSlot,
      Reservation,
      ParkingSession,
      GateEvent,
      Incident,
      MoveNotice,
      PatrolRecord,
      Coupon,
      Appeal,
      AppealEvidence,
      Order,
      Settlement,
      SettlementItem,
      AuditLog,
    ]),
    AuthModule,
  ],
  controllers: [
    ParkingController,
    AppealController,
    SettlementController,
    TraceController,
    AuditController,
  ],
  providers: [ParkingService, AppealService, SettlementService, AuditService],
})
export class ParkingModule {}

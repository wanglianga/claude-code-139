import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { round2 } from '../../common/enums';
import { determineLiability, LiabilityInput, LiabilityResult } from '../../common/liability';
import { Appeal } from '../../entities/appeal.entity';
import { AppealEvidence, EvidenceKind } from '../../entities/appeal-evidence.entity';
import { Reservation } from '../../entities/reservation.entity';
import { ParkingSpot } from '../../entities/parking-spot.entity';
import { ParkingSession } from '../../entities/parking-session.entity';
import { GateEvent } from '../../entities/gate-event.entity';
import { Incident } from '../../entities/incident.entity';
import { PatrolRecord } from '../../entities/patrol-record.entity';
import { User } from '../../entities/user.entity';
import { Order } from '../../entities/order.entity';
import { AuditService } from './audit.service';
import { ParkingService, normPlate } from './parking.service';
import { AdjudicateDto, CreateAppealDto } from './dto';

@Injectable()
export class AppealService {
  constructor(
    @InjectRepository(Appeal) private readonly appeals: Repository<Appeal>,
    @InjectRepository(AppealEvidence) private readonly evidenceRepo: Repository<AppealEvidence>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(ParkingSpot) private readonly spots: Repository<ParkingSpot>,
    @InjectRepository(ParkingSession) private readonly sessions: Repository<ParkingSession>,
    @InjectRepository(GateEvent) private readonly gateEvents: Repository<GateEvent>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(PatrolRecord) private readonly patrols: Repository<PatrolRecord>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly parking: ParkingService,
    private readonly audit: AuditService,
  ) {}

  async createAppeal(user: User, dto: CreateAppealDto) {
    let reservation: Reservation | null = null;
    let spot: ParkingSpot | null = null;
    const resId =
      dto.reservationId && dto.reservationId !== 'null' ? dto.reservationId : null;
    if (resId) {
      reservation = await this.reservations.findOne({ where: { id: resId } });
      if (!reservation) throw new NotFoundException('预约不存在');
      spot = reservation.spot;
      if (reservation.driver.id !== user.id && user.role !== 'property' && user.role !== 'admin')
        throw new ForbiddenException('只能为自己的订单发起申诉');
    } else if (dto.spotId) {
      spot = await this.spots.findOne({ where: { id: dto.spotId } });
      if (!spot) throw new NotFoundException('车位不存在');
    } else {
      throw new BadRequestException('必须关联预约或车位');
    }

    const appeal = await this.appeals.save(
      this.appeals.create({
        appellant: user,
        spot: spot!,
        reservation,
        plate: normPlate(dto.plate),
        reason: dto.reason,
        status: 'pending',
        responsibility: 'none',
        driverShare: 0,
        overtimeFee: 0,
        moveDelayPenalty: 0,
        ownerCompensation: 0,
        refundAmount: 0,
        creditImpact: false,
        creditDelta: 0,
      }),
    );

    if (dto.evidences?.length) {
      for (const e of dto.evidences) {
        await this.evidenceRepo.save(
          this.evidenceRepo.create({
            appeal,
            kind: e.kind as EvidenceKind,
            content: e.content,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
            favorsAppellant: e.favorsAppellant ?? null,
            spotCode: e.spotCode ?? null,
            plate: e.plate ? normPlate(e.plate) : null,
          }),
        );
      }
    }

    await this.audit.record(user.role, user.id, 'appeal_create', 'appeal', appeal.id, {
      reservation: reservation?.id ?? null,
      plate: appeal.plate,
    });

    // 自动进入核查并给出机器裁决建议
    const result = await this.runEngine(appeal.id);
    return result.appeal;
  }

  async listAppeals(status?: string) {
    return this.appeals.find({
      where: status ? { status: status as any } : {},
      order: { createdAt: 'DESC' },
      relations: { evidences: true },
      take: 200,
    });
  }

  async getAppeal(id: string) {
    const a = await this.appeals.findOne({
      where: { id },
      relations: { evidences: true },
    });
    if (!a) throw new NotFoundException('申诉不存在');
    return a;
  }

  // 汇集多源证据并运行责任判定引擎
  private async gather(id: string): Promise<{ appeal: Appeal; input: LiabilityInput }> {
    const appeal = await this.getAppeal(id);
    const evidences = await this.evidenceRepo.find({ where: { appeal: { id } } });
    const reservation = appeal.reservation
      ? await this.reservations.findOne({
          where: { id: appeal.reservation.id },
          relations: { dispatchedTo: { spot: true } as any },
        })
      : null;
    const spot = reservation?.spot ?? appeal.spot;

    const session = reservation
      ? await this.sessions.findOne({ where: { reservation: { id: reservation.id } } })
      : null;

    // 道闸识别（入场/离场）
    const gates = session
      ? await this.gateEvents.find({
          where: { session: { id: session.id } },
          order: { occurredAt: 'ASC' },
        })
      : [];
    const gateIn = gates.find((g) => g.direction === 'in');
    const gateOut = gates.find((g) => g.direction === 'out');

    // 物业巡查（同夜该小区）
    const patrolAll = await this.patrols.find({
      order: { at: 'ASC' },
      take: 500,
    });
    const nightPatrols = patrolAll.filter((p) => {
      if (!reservation) return p.spot.id === spot.id;
      return (
        p.spot.community.id === spot.community.id &&
        p.at.getTime() >= reservation.startTime.getTime() - 2 * 3600000 &&
        p.at.getTime() <= reservation.endTime.getTime() + 6 * 3600000
      );
    });

    // 现场照片证据
    const photos = evidences
      .filter((e) => e.kind === 'site_photo' || e.kind === 'nav_screen')
      .map((e) => ({
        at: e.occurredAt ?? appeal.createdAt,
        spotCode: e.spotCode ?? spot.code,
        plate: e.plate,
        kind: (e.kind === 'nav_screen' ? 'nav_screen' : (e.content.includes('燃油') ? 'fuel_on_charger' : e.spotCode && e.spotCode !== spot.code ? 'wrong_park' : 'scene')) as any,
        note: e.content,
      }));

    // 业主回家
    const ownerReturnedAt = reservation?.slot?.ownerReturnedAt ?? null;

    // 异常单：调度、信号、占位、燃油车
    const incidents = reservation
      ? await this.incidents.find({
          where: { reservation: { id: reservation.id } },
          order: { occurredAt: 'ASC' },
          relations: { moveNotices: true },
        })
      : [];
    const dispatchIncident = incidents.find((i) => i.resolution?.action === 'dispatch');
    // 信号弱工单：按同小区同夜窗口归集（不局限于单个车位/预约）
    const weakSignalCount = await this.incidents
      .createQueryBuilder('i')
      .innerJoin('i.spot', 'sp')
      .where('sp.community_id = :cid', { cid: spot.community.id })
      .andWhere('i.type = :t', { t: 'weak_signal' })
      .andWhere(
        reservation
          ? 'i.occurredAt BETWEEN :a AND :b'
          : '1=1',
        reservation
          ? {
              a: new Date(reservation.startTime.getTime() - 2 * 3600000),
              b: new Date(reservation.endTime.getTime() + 6 * 3600000),
            }
          : {},
      )
      .getCount();
    const weakSignal =
      incidents.some((i) => i.type === 'weak_signal') || weakSignalCount > 0;

    // 调度因素仅在“申诉源单（本单被调度且未在本单完成服务）”时纳入；
    // 申诉目标单（predecessor 存在）说明调度已完成、新服务正常，超时/错停按独立事实判定
    const sourceDispatch =
      reservation && reservation.status === 'dispatched';
    const dispatchCauseIncident = incidents.find(
      (i) => i.type === 'stranger_occupation' || i.type === 'fuel_on_charger',
    );

    // 挪车通知
    const notices = incidents.flatMap((i) => i.moveNotices ?? []);
    const firstNotice = notices.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[0];
    // 信号差时通知视为未及时送达
    const noticeDelivered = firstNotice ? !weakSignal : false;

    // 实际停放车位：巡查/照片互证
    const patrolOther = nightPatrols.find(
      (p) => p.plate === appeal.plate && p.spot.code !== spot.code,
    );
    const photoOther = photos.find((p) => p.plate === appeal.plate && p.spotCode !== spot.code);
    const actualSpotCode = patrolOther?.spot.code ?? photoOther?.spotCode ?? (session ? session.actualSpot.code : spot.code);
    const actualSpot = await this.spots.findOne({ where: { code: actualSpotCode, community: { id: spot.community.id } } });

    const input: LiabilityInput = {
      plate: appeal.plate,
      reservedSpotCode: spot.code,
      actualSpotCode,
      reservedStart: reservation?.startTime ?? appeal.createdAt,
      reservedEnd: reservation?.endTime ?? appeal.createdAt,
      entry: session?.entryTime ?? gateIn?.occurredAt ?? null,
      exit: session?.exitTime ?? gateOut?.occurredAt ?? null,
      vehicleType: (reservation?.vehicleType ?? 'ev') as 'ev' | 'fuel',
      reservedSpotIsCharger: spot.isChargerSpot,
      actualSpotIsCharger: actualSpot?.isChargerSpot ?? false,
      anprEntry: gateIn
        ? {
            plate: gateIn.recognizedPlate,
            confidence: gateIn.confidence,
            at: gateIn.occurredAt,
            matchType: gateIn.matchType,
            note: gateIn.note,
          }
        : null,
      anprExit: gateOut
        ? {
            plate: gateOut.recognizedPlate,
            confidence: gateOut.confidence,
            at: gateOut.occurredAt,
            matchType: gateOut.matchType,
            note: gateOut.note,
          }
        : null,
      photos,
      patrols: nightPatrols.map((p) => ({
        at: p.at,
        spotCode: p.spot.code,
        plate: p.plate,
        note: p.note,
      })),
      ownerReturnedAt: ownerReturnedAt ? new Date(ownerReturnedAt) : null,
      platformDispatch:
        sourceDispatch
          ? {
              fromSpot: spot.code,
              toSpot: reservation.dispatchedTo?.spot?.code ?? dispatchIncident?.resolution?.toSpot ?? '其他车位',
              at: dispatchIncident?.occurredAt ?? reservation.createdAt,
              note: reservation.dispatchNote,
            }
          : dispatchCauseIncident
            ? {
                fromSpot: spot.code,
                toSpot: dispatchCauseIncident.resolution?.toSpot ?? '其他车位',
                at: dispatchCauseIncident.occurredAt,
                note: dispatchCauseIncident.resolution?.note ?? dispatchCauseIncident.description,
              }
            : null,
      weakSignalRecorded: weakSignal,
      noticeSentAt: firstNotice?.sentAt ?? null,
      noticeDelivered,
      driverStatement: appeal.reason,
    };
    return { appeal, input };
  }

  async runEngine(id: string): Promise<{ appeal: Appeal; engine: LiabilityResult }> {
    const { appeal, input } = await this.gather(id);
    const engine = determineLiability(input);

    appeal.status = 'under_review';
    appeal.responsibility = engine.responsibility;
    appeal.driverShare = engine.driverShare;
    appeal.findings = {
      reason: engine.reason,
      evidenceChain: engine.findings,
      overtimeMinutes: engine.overtimeMinutes,
      moveDelayMinutes: engine.moveDelayMinutes,
      auto: true,
    };
    appeal.adjudicatorNote = `系统自动核查建议：${engine.reason}（待物业复核确认）`;
    await this.appeals.save(appeal);
    await this.audit.record('system', null, 'appeal_engine', 'appeal', appeal.id, {
      responsibility: engine.responsibility,
      driverShare: engine.driverShare,
      status: engine.status,
    });
    return { appeal: await this.getAppeal(id), engine };
  }

  // 物业复核裁决（可附加证据或人工改判），随后重算费用、退款与信用
  async adjudicate(user: User, id: string, dto: AdjudicateDto) {
    const { appeal, input } = await this.gather(id);
    if (appeal.status === 'upheld' || appeal.status === 'partial' || appeal.status === 'rejected') {
      // 允许物业重新复核一次
    }

    if (dto.evidences?.length) {
      for (const e of dto.evidences) {
        await this.evidenceRepo.save(
          this.evidenceRepo.create({
            appeal,
            kind: e.kind as EvidenceKind,
            content: e.content,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
            favorsAppellant: e.favorsAppellant ?? null,
            spotCode: e.spotCode ?? null,
            plate: e.plate ? normPlate(e.plate) : null,
          }),
        );
      }
    }

    const rerun = await this.gather(id);
    const engine = determineLiability(rerun.input);

    // 人工改判（留痕）
    let responsibility = engine.responsibility;
    let driverShare = engine.driverShare;
    let status = engine.status;
    const overrides: string[] = [];
    if (dto.overrideResponsibility) {
      responsibility = dto.overrideResponsibility;
      overrides.push(`责任改判为 ${dto.overrideResponsibility}`);
    }
    if (dto.overrideDriverShare !== undefined) {
      driverShare = dto.overrideDriverShare;
      overrides.push(`车主承担比例改判为 ${dto.overrideDriverShare}`);
    }
    if (dto.overrideResponsibility || dto.overrideDriverShare !== undefined) {
      if (driverShare >= 1) status = 'rejected';
      else if (driverShare > 0) status = 'partial';
      else status = 'upheld';
    }

    // 重新计费：本单无在场会话（调度源单）时落到实际服务的目标预约/订单
    const reservation = await this.reservations.findOne({
      where: { id: rerun.appeal.reservation?.id ?? '' },
      relations: { dispatchedTo: { spot: true } },
    }).then((r) => r ?? rerun.appeal.reservation);
    let session = reservation
      ? await this.sessions.findOne({ where: { reservation: { id: reservation.id } } })
      : null;
    let billingReservation = reservation;
    if (!session && reservation?.dispatchedTo?.id) {
      session = await this.sessions.findOne({
        where: { reservation: { id: reservation.dispatchedTo.id } },
      });
      billingReservation = session ? reservation.dispatchedTo : reservation;
    }
    let billing: any = null;
    let order: Order | null = null;
    let refund = 0;

    if (session && billingReservation) {
      const existingOrder = await this.orders.findOne({
        where: { reservation: { id: billingReservation.id } },
      });
      billing = await this.parking.buildBilling(
        session,
        existingOrder?.couponDiscount ?? 0,
        { responsibility, driverShare },
        {
          noticeSentAt: input.noticeSentAt,
          ownerReturnedEarly: responsibility === 'owner',
          evicted:
            billingReservation.status === 'evicted' ||
            billingReservation.status === 'dispatched',
          wrongParked:
            !!input.actualSpotCode && input.actualSpotCode !== input.reservedSpotCode,
        },
      );

      if (existingOrder) {
        order = existingOrder;
        const oldPaid = order.paid;
        order.baseFee = billing.baseFee;
        order.overtimeFee = billing.overtimeFee;
        order.moveDelayPenalty = billing.moveDelayPenalty;
        order.abnormalCompensation = billing.abnormalCompensation;
        order.ownerCompensation = billing.ownerCompensation;
        order.responsibility = responsibility;
        order.payable = billing.payable;
        order.appeal = appeal;
        if (billing.payable < oldPaid) {
          // 多收 → 退款
          refund = round2(oldPaid - billing.payable);
          order.refund = refund;
          order.status = 'partial_refund';
        } else if (billing.payable > oldPaid) {
          // 少缴 → 裁决后追缴（模拟当场补收）
          const extra = round2(billing.payable - oldPaid);
          order.extraCharges = round2((order.extraCharges ?? 0) + extra);
          order.paid = round2(order.paid + extra);
        }
        await this.orders.save(order);
        session.billing = { ...billing, refund, adjudicated: true };
        await this.sessions.save(session);
      } else {
        // 无离场账单（如业主提前回家被清退的会话）：按裁决补建账单，模拟补收/补偿入账
        order = await this.orders.save(
          this.orders.create({
            plate: session.plate,
            kind: 'parking',
            status: 'paid',
            reservation: billingReservation,
            session,
            spot: billingReservation.spot,
            appeal,
            baseFee: billing.baseFee,
            overtimeFee: billing.overtimeFee,
            moveDelayPenalty: billing.moveDelayPenalty,
            strangerPenalty: 0,
            couponDiscount: billing.couponDiscount,
            abnormalCompensation: billing.abnormalCompensation,
            ownerCompensation: billing.ownerCompensation,
            extraCharges: 0,
            responsibility,
            payable: billing.payable,
            paid: billing.payable,
            paidAt: new Date(),
            refund: 0,
          }),
        );
        session.billing = { ...billing, adjudicated: true, lateOrder: true };
        await this.sessions.save(session);
      }
    }

    // 信用处置（仅一次）：引擎判定有责，或物业人工改判为部分/有责
    let creditDelta = 0;
    const liable = status === 'partial' || status === 'rejected';
    if (liable && driverShare > 0 && !appeal.creditImpact) {
      if (engine.creditImpact) {
        creditDelta = Math.round(engine.creditDelta * Math.max(driverShare, 0.5));
      } else if (status === 'partial') {
        creditDelta = -3;
      } else {
        creditDelta = -5;
      }
      const driver = await this.users.findOne({ where: { id: appeal.appellant.id } });
      if (driver) {
        driver.creditScore = Math.max(0, Math.min(100, driver.creditScore + creditDelta));
        await this.users.save(driver);
      }
    }
    const creditImpact = creditDelta !== 0;

    appeal.status = status;
    appeal.responsibility = responsibility;
    appeal.driverShare = driverShare;
    appeal.overtimeFee = billing?.overtimeFee ?? 0;
    appeal.moveDelayPenalty = billing?.moveDelayPenalty ?? 0;
    appeal.ownerCompensation = billing?.ownerCompensation ?? 0;
    appeal.refundAmount = refund;
    appeal.creditImpact = creditImpact;
    appeal.creditDelta = creditDelta;
    appeal.findings = {
      reason: engine.reason,
      evidenceChain: engine.findings,
      overtimeMinutes: engine.overtimeMinutes,
      moveDelayMinutes: engine.moveDelayMinutes,
      manualOverrides: overrides,
      billingExplanation: billing?.explanation ?? null,
      auto: false,
    };
    appeal.adjudicatorId = user.id;
    appeal.adjudicatorNote = dto.note
      ? `${overrides.join('；')}${overrides.length ? '；' : ''}${dto.note}`
      : `${overrides.join('；') || '物业复核确认系统裁决'}`;
    appeal.adjudicatedAt = new Date();
    await this.appeals.save(appeal);

    await this.audit.record('property', user.id, 'appeal_adjudicate', 'appeal', appeal.id, {
      status,
      responsibility,
      driverShare,
      refund,
      creditDelta,
    });

    return this.getAppeal(id);
  }
}

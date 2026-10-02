import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Not, Repository } from 'typeorm';
import {
  GateMatchType,
  IncidentType,
  MONTHLY_PRIORITY_HEADSTART_HOURS,
  round2,
} from '../../common/enums';
import { slotDateToDate } from '../../common/time';
import { Community } from '../../entities/community.entity';
import { ParkingSpot } from '../../entities/parking-spot.entity';
import { ShareSlot } from '../../entities/share-slot.entity';
import { User } from '../../entities/user.entity';
import { Reservation } from '../../entities/reservation.entity';
import { ParkingSession } from '../../entities/parking-session.entity';
import { GateEvent } from '../../entities/gate-event.entity';
import { Incident } from '../../entities/incident.entity';
import { MoveNotice } from '../../entities/move-notice.entity';
import { PatrolRecord } from '../../entities/patrol-record.entity';
import { Coupon } from '../../entities/coupon.entity';
import { Order } from '../../entities/order.entity';
import { AuditService } from './audit.service';
import {
  CreateReservationDto,
  CreateSlotDto,
  DispatchDto,
  GateEntryDto,
  GateExitDto,
  MoveNoticeDto,
  NoticeAckDto,
  OwnerReturnDto,
  PatrolDto,
  PublishSpotDto,
  ReportIncidentDto,
  ResolveIncidentDto,
  ReviewSpotDto,
} from './dto';

export function normPlate(p: string): string {
  return (p || '').replace(/[\s-]/g, '').toUpperCase();
}

@Injectable()
export class ParkingService {
  constructor(
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(ParkingSpot) private readonly spots: Repository<ParkingSpot>,
    @InjectRepository(ShareSlot) private readonly slotRepo: Repository<ShareSlot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(ParkingSession) private readonly sessions: Repository<ParkingSession>,
    @InjectRepository(GateEvent) private readonly gateEvents: Repository<GateEvent>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(MoveNotice) private readonly notices: Repository<MoveNotice>,
    @InjectRepository(PatrolRecord) private readonly patrols: Repository<PatrolRecord>,
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly audit: AuditService,
    private readonly ds: DataSource,
  ) {}

  effectiveRate(spot: ParkingSpot, community: Community): number {
    return spot.hourlyRateOverride != null ? spot.hourlyRateOverride : community.hourlyRate;
  }

  // ---------------- 查询 ----------------

  listCommunities() {
    return this.communities.find();
  }

  async listBookableSpots(communityId?: string) {
    const spots = await this.spots.find({
      where: { approvalStatus: 'approved', active: true, ...(communityId ? {} : {}) },
      relations: { slots: true },
    });
    return spots
      .filter((s) => !communityId || s.community.id === communityId)
      .map((s) => ({
        id: s.id,
        code: s.code,
        zone: s.zone,
        community: { id: s.community.id, name: s.community.name },
        nearCharger: s.nearCharger,
        isChargerSpot: s.isChargerSpot,
        allowVisitor: s.allowVisitor,
        monthlyPriority: s.monthlyPriority,
        navigationHint: s.navigationHint,
        hourlyRate: this.effectiveRate(s, s.community),
        nightlyCap: s.community.nightlyCap,
        slots: s.slots
          .filter((sl) => !sl.closed)
          .map((sl) => ({
            id: sl.id,
            date: sl.date,
            startMinute: sl.startMinute,
            endMinute: sl.endMinute,
            guaranteed: sl.guaranteed,
            ownerReturnedAt: sl.ownerReturnedAt,
          })),
      }));
  }

  async mySpots(userId: string) {
    const spots = await this.spots.find({
      where: { owner: { id: userId } },
      relations: { slots: true },
    });
    return spots.map((s) => ({
      id: s.id,
      code: s.code,
      zone: s.zone,
      deedNo: s.deedNo,
      community: { id: s.community.id, name: s.community.name },
      nearCharger: s.isChargerSpot,
      isChargerSpot: s.isChargerSpot,
      allowVisitor: s.allowVisitor,
      monthlyPriority: s.monthlyPriority,
      approvalStatus: s.approvalStatus,
      reviewNote: s.reviewNote,
      navigationHint: s.navigationHint,
      slots: s.slots,
    }));
  }

  listPendingSpots() {
    return this.spots.find({
      where: { approvalStatus: In(['pending', 'rejected']) },
      order: { createdAt: 'ASC' },
    });
  }

  async listReservations(user: any, scope: string) {
    let list: Reservation[];
    const withRel = { dispatchedTo: { spot: true } as any };
    if (scope === 'mine' && user.role === 'driver') {
      list = await this.reservations.find({
        where: { driver: { id: user.id } },
        order: { startTime: 'DESC' },
        relations: withRel,
      });
    } else if (scope === 'owner') {
      const mySpotIds = (await this.spots.find({ where: { owner: { id: user.id } } })).map(
        (s) => s.id,
      );
      if (!mySpotIds.length) return [];
      list = await this.reservationsBySpots(mySpotIds);
    } else {
      list = await this.reservations.find({
        order: { startTime: 'DESC' },
        take: 200,
        relations: withRel,
      });
    }
    return this.attachSessionFlag(list);
  }

  private async reservationsBySpots(spotIds: string[]) {
    if (!spotIds.length) return [];
    return this.reservations.find({
      where: { spot: In(spotIds) },
      order: { startTime: 'DESC' },
      take: 200,
      relations: { dispatchedTo: { spot: true } },
    });
  }

  private async attachSessionFlag(list: Reservation[]) {
    const sessions = list.length
      ? await this.sessions.find({
          where: { reservation: In(list.map((r) => r.id)) },
        })
      : [];
    const byRes = new Map(sessions.map((s) => [s.reservation.id, s]));
    return list.map((r) => this.shapeReservation(r, byRes.get(r.id) ?? null));
  }

  shapeReservation(r: Reservation, session: ParkingSession | null) {
    return {
      id: r.id,
      plate: r.plate,
      vehicleType: r.vehicleType,
      isVisitor: r.isVisitor,
      driver: { id: r.driver.id, displayName: r.driver.displayName, phone: r.driver.phone },
      spot: {
        id: r.spot.id,
        code: r.spot.code,
        zone: r.spot.zone,
        community: { id: r.spot.community.id, name: r.spot.community.name },
      },
      slotId: r.slot.id,
      slotDate: r.slot.date,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      estimatedFee: r.estimatedFee,
      dispatchNote: r.dispatchNote,
      dispatchedTo: r.dispatchedTo
        ? { id: r.dispatchedTo.id, code: (r.dispatchedTo as any).spot?.code }
        : null,
      session: session
        ? {
            id: session.id,
            entryTime: session.entryTime,
            exitTime: session.exitTime,
            status: session.status,
            entryMatchType: session.entryMatchType,
            exitMatchType: session.exitMatchType,
          }
        : null,
    };
  }

  async getReservation(id: string) {
    const r = await this.reservations.findOne({
      where: { id },
      relations: { dispatchedTo: { spot: true } },
    });
    if (!r) throw new NotFoundException('预约不存在');
    const session = await this.sessions.findOne({ where: { reservation: { id } } });
    return this.shapeReservation(r, session);
  }

  // ---------------- 车位发布与物业审核 ----------------

  async publishSpot(user: User, dto: PublishSpotDto) {
    const community = await this.communities.findOne({ where: { id: dto.communityId } });
    if (!community) throw new NotFoundException('小区不存在');
    const dup = await this.spots.findOne({ where: { community: { id: community.id }, code: dto.code } });
    if (dup) throw new BadRequestException('该小区内车位编号已存在');

    const spot = this.spots.create({
      code: dto.code,
      zone: dto.zone,
      deedNo: dto.deedNo,
      community,
      owner: user,
      nearCharger: dto.nearCharger,
      isChargerSpot: dto.isChargerSpot,
      allowVisitor: dto.allowVisitor,
      monthlyPriority: dto.monthlyPriority,
      navigationHint: dto.navigationHint || '',
      hourlyRateOverride: dto.hourlyRateOverride ?? null,
      approvalStatus: 'pending',
    });
    const saved = await this.spots.save(spot);
    await this.audit.record('owner', user.id, 'publish_spot', 'spot', saved.id, {
      code: saved.code,
      deedNo: saved.deedNo,
      nearCharger: saved.nearCharger,
      isChargerSpot: saved.isChargerSpot,
      allowVisitor: saved.allowVisitor,
      monthlyPriority: saved.monthlyPriority,
    });
    return saved;
  }

  async reviewSpot(user: User, spotId: string, dto: ReviewSpotDto) {
    const spot = await this.spots.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('车位不存在');
    spot.approvalStatus = dto.approve ? 'approved' : 'rejected';
    spot.reviewNote = dto.note ?? null;
    await this.spots.save(spot);
    await this.audit.record('property', user.id, dto.approve ? 'approve_spot' : 'reject_spot', 'spot', spot.id, {
      note: dto.note ?? null,
    });
    return spot;
  }

  // ---------------- 共享时段 ----------------

  async createSlot(user: User, dto: CreateSlotDto) {
    const spot = await this.spots.findOne({ where: { id: dto.spotId } });
    if (!spot) throw new NotFoundException('车位不存在');
    if (spot.owner.id !== user.id) throw new ForbiddenException('只能为自己的车位发布时段');
    if (dto.endMinute <= dto.startMinute) throw new BadRequestException('结束时间必须晚于开始时间');
    if (spot.approvalStatus !== 'approved') throw new BadRequestException('车位尚未通过物业审核');

    const slot = this.slotRepo.create({
      spot,
      date: dto.date,
      startMinute: dto.startMinute,
      endMinute: dto.endMinute,
      guaranteed: dto.guaranteed ?? true,
      ownerReturnedAt: null,
      closed: false,
    });
    const saved = await this.slotRepo.save(slot);
    await this.audit.record('owner', user.id, 'create_slot', 'slot', saved.id, {
      spot: spot.code,
      date: dto.date,
      window: `${dto.startMinute}-${dto.endMinute}`,
    });
    return saved;
  }

  // ---------------- 预约（时段冲突 + 月租车优先规则） ----------------

  async createReservation(user: User, dto: CreateReservationDto) {
    const slot = await this.slotRepo.findOne({ where: { id: dto.slotId }, relations: { spot: true } });
    if (!slot) throw new NotFoundException('共享时段不存在');
    const spot = await this.spots.findOne({ where: { id: slot.spot.id }, relations: { community: true } });
    if (!spot || spot.approvalStatus !== 'approved' || !spot.active)
      throw new BadRequestException('车位不可预约');
    if (slot.closed) throw new BadRequestException('该共享时段已关闭');

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (slot.ownerReturnedAt && start.getTime() >= slot.ownerReturnedAt.getTime()) {
      throw new BadRequestException('业主已提前回家，该时段之后的车位不再开放预约');
    }
    const slotStart = slotDateToDate(slot.date, slot.startMinute);
    const slotEnd = slotDateToDate(slot.date, slot.endMinute);
    if (start < slotStart || end > slotEnd) {
      throw new BadRequestException(
        `预约时间必须落在共享时段内（${slotStart.toISOString()} ~ ${slotEnd.toISOString()}）`,
      );
    }
    if (end <= start) throw new BadRequestException('结束时间必须晚于开始时间');

    if ((dto.isVisitor ?? false) && !spot.allowVisitor)
      throw new BadRequestException('该车位不接受访客车辆');
    if ((dto.vehicleType ?? 'ev') === 'fuel' && spot.isChargerSpot)
      throw new BadRequestException('燃油车不能预约充电车位');

    // 月租车优先规则：非月租车只能在时段开始前 24h 内下单
    if (spot.monthlyPriority === 'monthly_first' && !user.isMonthlyTenant) {
      const hoursAhead = (slotStart.getTime() - Date.now()) / 3600000;
      if (hoursAhead > MONTHLY_PRIORITY_HEADSTART_HOURS) {
        throw new BadRequestException(
          `该车位执行月租车优先：非月租车仅可在开始前 ${MONTHLY_PRIORITY_HEADSTART_HOURS} 小时内预约（当前提前 ${hoursAhead.toFixed(1)} 小时）`,
        );
      }
    }

    // 同时段占用冲突校验
    const conflict = await this.reservations
      .createQueryBuilder('r')
      .innerJoin('r.slot', 'sl')
      .where('sl.spot_id = :spotId', { spotId: spot.id })
      .andWhere('r.status IN (:...statuses)', { statuses: ['booked', 'dispatched'] })
      .andWhere('r.startTime < :end AND r.endTime > :start', { start, end })
      .getOne();
    if (conflict) throw new BadRequestException('该时段已被其他预约占用');

    const hours = (end.getTime() - start.getTime()) / 3600000;
    const rate = this.effectiveRate(spot, spot.community);
    const estimatedFee = round2(Math.min(hours * rate, spot.community.nightlyCap));

    const r = this.reservations.create({
      plate: normPlate(dto.plate),
      vehicleType: dto.vehicleType ?? 'ev',
      isVisitor: dto.isVisitor ?? false,
      driver: user,
      spot,
      slot,
      startTime: start,
      endTime: end,
      status: 'booked',
      estimatedFee,
    });
    const saved = await this.reservations.save(r);
    await this.audit.record('driver', user.id, 'create_reservation', 'reservation', saved.id, {
      plate: saved.plate,
      spot: spot.code,
      start: start.toISOString(),
      end: end.toISOString(),
      estimatedFee,
    });
    return this.getReservation(saved.id);
  }

  async cancelReservation(user: User, id: string) {
    const r = await this.reservations.findOne({ where: { id } });
    if (!r) throw new NotFoundException('预约不存在');
    if (r.driver.id !== user.id && user.role !== 'property' && user.role !== 'admin')
      throw new ForbiddenException('无权取消该预约');
    if (r.status !== 'booked') throw new BadRequestException('当前状态不可取消');
    // 已入场车辆取消预约：物理离场时仍由道闸结算（车牌绑定同一笔服务）
    r.status = 'cancelled';
    await this.reservations.save(r);
    await this.audit.record(user.role, user.id, 'cancel_reservation', 'reservation', r.id, {});
    return { ok: true };
  }

  // ---------------- 道闸：入场 ----------------

  async gateEntry(user: any, dto: GateEntryDto) {
    const reservationId =
      dto.reservationId && dto.reservationId !== 'null' ? dto.reservationId : undefined;
    const at = dto.at ? new Date(dto.at) : new Date();
    const plateInput = dto.verifiedPlate || dto.recognizedPlate || null;

    let reservation: Reservation | null = null;
    if (reservationId) {
      reservation = await this.reservations.findOne({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException('预约不存在');
    } else if (plateInput) {
      reservation = await this.findActiveReservationByPlate(normPlate(plateInput), at);
    }

    const confidence = dto.confidence ?? (dto.manual ? 1 : 0.99);
    let matchType: GateMatchType;
    let opened: boolean;
    let effectivePlate: string | null = plateInput;

    if (dto.manual) {
      matchType = 'manual';
      opened = true;
      effectivePlate = dto.verifiedPlate
        ? normPlate(dto.verifiedPlate)
        : reservation?.plate ?? normPlate(dto.recognizedPlate || '');
    } else if (reservation && dto.recognizedPlate) {
      const recognized = normPlate(dto.recognizedPlate);
      if (recognized === reservation.plate && confidence >= 0.75) {
        matchType = 'matched';
        opened = true;
        effectivePlate = reservation.plate;
      } else {
        matchType = 'failed';
        opened = false;
      }
    } else if (dto.recognizedPlate && !reservation) {
      matchType = 'unknown';
      opened = false; // 无预约陌生车不自动抬杆
    } else {
      matchType = 'failed';
      opened = false;
    }

    const gate = await this.gateEvents.save(
      this.gateEvents.create({
        direction: 'in',
        recognizedPlate: dto.recognizedPlate ? normPlate(dto.recognizedPlate) : null,
        confidence,
        matchType,
        barrierOpened: opened,
        manualOperatorId: dto.manual ? user.id : null,
        note: dto.note ?? null,
        spot: reservation ? reservation.spot : null,
        occurredAt: at,
      }),
    );

    let session: ParkingSession | null = null;
    let incident: Incident | null = null;
    const response: any = {
      gateEventId: gate.id,
      matchType,
      barrierOpened: opened,
      at,
    };

    if (opened && reservation) {
      const exist = await this.sessions.findOne({ where: { reservation: { id: reservation.id } } });
      if (exist) throw new BadRequestException('该预约已存在入场记录');
      const nav = this.buildNavigation(reservation.spot);
      session = await this.sessions.save(
        this.sessions.create({
          reservation,
          actualSpot: reservation.spot,
          plate: reservation.plate,
          entryTime: at,
          status: 'in',
          entryMatchType: matchType,
          navigationRoute: nav,
        }),
      );
      gate.session = session;
      await this.gateEvents.save(gate);
      response.sessionId = session.id;
      response.navigation = nav;
      await this.audit.record(
        dto.manual ? 'property' : 'system',
        dto.manual ? user.id : null,
        'gate_entry',
        'session',
        session.id,
        { reservation: reservation.id, plate: reservation.plate, matchType },
      );
    } else if (matchType === 'failed') {
      // 识别失败：自动建异常单，等待物业人工放行
      incident = await this.incidents.save(
        this.incidents.create({
          type: 'recognition_failed',
          status: 'open',
          spot: reservation?.spot ?? (await this.anySpot()),
          reservation,
          session: null,
          involvedPlate: dto.recognizedPlate ? normPlate(dto.recognizedPlate) : null,
          reportedBy: null,
          description: `入场道闸车牌识别失败（识别值：${dto.recognizedPlate ?? '无'}，置信度 ${confidence}），道闸未抬起，等待人工核验`,
          occurredAt: at,
        }),
      );
      gate.note = gate.note ? `${gate.note}；异常单 ${incident.id}` : `异常单 ${incident.id}`;
      await this.gateEvents.save(gate);
      await this.audit.record('system', null, 'incident_open', 'incident', incident.id, {
        type: 'recognition_failed',
      });
      response.incidentId = incident.id;
      response.hint = '识别失败，请联系物业人工放行';
    } else if (matchType === 'unknown') {
      response.hint = '未查询到该车牌的有效预约，请转物业登记';
    }

    return response;
  }

  private async anySpot(): Promise<ParkingSpot> {
    const s = await this.spots.findOne({ order: { createdAt: 'ASC' } });
    if (!s) throw new BadRequestException('系统中还没有任何车位');
    return s;
  }

  private buildNavigation(spot: ParkingSpot): string {
    const charger = spot.isChargerSpot
      ? '充电车位'
      : spot.nearCharger
        ? '靠近充电桩'
        : '';
    return `入口→${spot.zone}→车位 ${spot.code}（${charger}，按地面编号停放）${spot.navigationHint ? '；' + spot.navigationHint : ''}`;
  }

  private async findActiveReservationByPlate(plate: string, at: Date): Promise<Reservation | null> {
    const list = await this.reservations.find({
      where: { plate, status: In(['booked', 'dispatched']) },
      order: { startTime: 'ASC' },
    });
    return (
      list.find(
        (r) =>
          at.getTime() >= r.startTime.getTime() - 30 * 60000 &&
          at.getTime() <= r.endTime.getTime() + 60 * 60000,
      ) ?? null
    );
  }

  // ---------------- 道闸：离场结算 ----------------

  async gateExit(user: any, dto: GateExitDto): Promise<any> {
    const reservationId =
      dto.reservationId && dto.reservationId !== 'null' ? dto.reservationId : undefined;
    const at = dto.at ? new Date(dto.at) : new Date();

    let session: ParkingSession | null = null;
    if (reservationId) {
      session = await this.sessions.findOne({ where: { reservation: { id: reservationId } } });
    } else {
      const plate = normPlate(dto.verifiedPlate || dto.recognizedPlate || '');
      session = await this.sessions.findOne({
        where: { plate, status: 'in' },
        order: { entryTime: 'DESC' },
      });
    }
    if (!session) throw new NotFoundException('未找到在场的停车会话');

    const confidence = dto.confidence ?? (dto.manual ? 1 : 0.99);
    let matchType: GateMatchType = 'failed';
    if (dto.manual) matchType = 'manual';
    else if (dto.recognizedPlate && normPlate(dto.recognizedPlate) === session.plate && confidence >= 0.75)
      matchType = 'matched';
    else if (!dto.recognizedPlate) matchType = 'failed';
    else matchType = 'failed';

    const gate = await this.gateEvents.save(
      this.gateEvents.create({
        direction: 'out',
        recognizedPlate: dto.recognizedPlate ? normPlate(dto.recognizedPlate) : null,
        confidence,
        matchType,
        barrierOpened: dto.manual || matchType === 'matched',
        manualOperatorId: dto.manual ? user.id : null,
        note: dto.note ?? null,
        session,
        spot: session.actualSpot,
        occurredAt: at,
      }),
    );
    if (!gate.barrierOpened) {
      return {
        gateEventId: gate.id,
        matchType,
        barrierOpened: false,
        hint: '离场识别失败，请物业人工放行后完成结算',
      };
    }

    session.exitTime = at;
    session.status = 'out';
    session.exitMatchType = matchType;

    // 优惠券
    let couponAmount = 0;
    let coupon: Coupon | null = null;
    if (dto.couponCode) {
      coupon = await this.coupons.findOne({ where: { code: dto.couponCode, used: false } });
      if (!coupon || (coupon.expiresAt && coupon.expiresAt < new Date()))
        throw new BadRequestException('优惠券不可用');
      if (coupon.owner.id !== session.reservation.driver.id)
        throw new BadRequestException('优惠券不属于该车主');
      couponAmount = coupon.amount;
    }

    // 已存在订单（异常重入保护）
    const existOrder = await this.orders.findOne({
      where: { reservation: { id: session.reservation.id } },
    });

    const result = await this.ds.transaction(async (m) => {
      if (coupon) {
        coupon.used = true;
        coupon.usedAt = at;
        await m.save(coupon);
      }
      await m.save(session);
      let order: Order;
      if (existOrder) {
        order = existOrder;
      } else {
        order = this.orders.create({
          plate: session.plate,
          kind: 'parking',
          reservation: session.reservation,
          session,
        });
      }
      const billing = await this.buildBilling(session, couponAmount, null);
      order.baseFee = billing.baseFee;
      order.overtimeFee = billing.overtimeFee;
      order.moveDelayPenalty = billing.moveDelayPenalty;
      order.strangerPenalty = billing.strangerPenalty;
      order.couponDiscount = billing.couponDiscount;
      order.abnormalCompensation = billing.abnormalCompensation;
      order.ownerCompensation = billing.ownerCompensation;
      order.responsibility = 'none'; // 离场即时结算无争议；若后续申诉改判会更新
      order.payable = billing.payable;
      order.paid = billing.payable; // 离场模拟自动支付
      order.paidAt = at;
      order.refund = 0;
      order.status = 'paid';
      order.couponId = coupon?.id ?? null;
      await m.save(order);
      session.billing = { ...billing };
      await m.save(session);
      return { order, billing };
    });

    await this.audit.record(
      dto.manual ? 'property' : 'system',
      dto.manual ? user.id : null,
      'gate_exit_settle',
      'order',
      result.order.id,
      { session: session.id, payable: result.billing.payable, matchType },
    );

    return {
      gateEventId: gate.id,
      matchType,
      barrierOpened: true,
      sessionId: session.id,
      orderId: result.order.id,
      billing: result.billing,
    };
  }

  // 非道闸离场（调度/清退/取消）时对已实际停放时段立即生成结算订单
  private async settleClosedSession(
    session: ParkingSession,
    reservation: Reservation,
    at: Date,
    opts: {
      responsibility: any;
      driverShare: number;
      ownerReturnedEarly?: boolean;
      evicted?: boolean;
      trigger: string;
    },
  ): Promise<Order | null> {
    const existing = await this.orders.findOne({
      where: { reservation: { id: reservation.id } },
    });
    if (existing) return existing;
    session.exitTime = at;
    const billing = await this.buildBilling(
      session,
      0,
      { responsibility: opts.responsibility, driverShare: opts.driverShare },
      {
        noticeSentAt: null,
        ownerReturnedEarly: opts.ownerReturnedEarly ?? false,
        evicted: opts.evicted ?? false,
      },
    );
    const order = await this.orders.save(
      this.orders.create({
        plate: session.plate,
        kind: 'parking',
        status: 'paid',
        reservation,
        session,
        spot: reservation.spot,
        baseFee: billing.baseFee,
        overtimeFee: billing.overtimeFee,
        moveDelayPenalty: billing.moveDelayPenalty,
        strangerPenalty: 0,
        couponDiscount: 0,
        abnormalCompensation: billing.abnormalCompensation,
        ownerCompensation: billing.ownerCompensation,
        extraCharges: 0,
        responsibility: opts.responsibility,
        payable: billing.payable,
        paid: billing.payable,
        paidAt: at,
        refund: 0,
      }),
    );
    session.billing = { ...billing, settledBy: opts.trigger };
    await this.sessions.save(session);
    await this.audit.record('system', null, `auto_settle_${opts.trigger}`, 'order', order.id, {
      session: session.id,
      payable: billing.payable,
    });
    return order;
  }

  // 计费组装（供离场与申诉复核共用）
  async buildBilling(
    session: ParkingSession,
    couponAmount: number,
    liability: { responsibility: any; driverShare: number } | null,
    overrides?: {
      noticeSentAt?: Date | null;
      ownerReturnedEarly?: boolean;
      evicted?: boolean;
      wrongParked?: boolean;
    },
  ) {
    const reservation = session.reservation;
    const spot = reservation.spot;
    const community = spot.community;
    // 动态加载社区（entity 快照可能为桩对象）
    const communityFull = await this.communities.findOne({ where: { id: community.id } });
    const { computeBilling } = await import('../../common/billing');

    const noticeSentAt =
      overrides?.noticeSentAt !== undefined
        ? overrides.noticeSentAt
        : await this.latestNoticeSentAt(reservation.id, session.plate);

    return computeBilling({
      entry: session.entryTime,
      exit: session.exitTime ?? new Date(),
      reservedStart: reservation.startTime,
      reservedEnd: reservation.endTime,
      hourlyRate: this.effectiveRate(spot, communityFull!),
      nightlyCap: communityFull!.nightlyCap,
      overtimeMultiplier: communityFull!.overtimeMultiplier,
      moveGraceMinutes: communityFull!.moveGraceMinutes,
      noticeSentAt,
      responsibility: liability?.responsibility ?? 'none',
      driverShare: liability?.driverShare ?? 1,
      couponAmount,
      ownerReturnedEarly: overrides?.ownerReturnedEarly ?? false,
      evicted: overrides?.evicted ?? reservation.status === 'evicted',
      wrongParked: overrides?.wrongParked ?? false,
    });
  }

  async latestNoticeSentAt(reservationId: string, plate: string): Promise<Date | null> {
    const incidents = await this.incidents.find({
      where: { reservation: { id: reservationId } },
      relations: { moveNotices: true },
    });
    let latest: Date | null = null;
    for (const inc of incidents) {
      for (const n of inc.moveNotices ?? []) {
        if (n.plate === plate && (!latest || n.sentAt > latest)) latest = n.sentAt;
      }
    }
    // 也查同车牌的异常（陌生占位等场景）
    const byPlate = await this.notices.find({ where: { plate } });
    for (const n of byPlate) {
      if (!latest || n.sentAt > latest) latest = n.sentAt;
    }
    return latest;
  }

  async listGateEvents(spotId?: string) {
    return this.gateEvents.find({
      where: spotId ? { spot: { id: spotId } } : {},
      order: { occurredAt: 'DESC' },
      take: 200,
    });
  }

  // ---------------- 夜间异常与调度 ----------------

  async ownerReturn(user: any, dto: OwnerReturnDto) {
    const slot = await this.slotRepo.findOne({ where: { id: dto.slotId }, relations: { spot: true } });
    if (!slot) throw new NotFoundException('共享时段不存在');
    const spot = await this.spots.findOne({ where: { id: slot.spot.id } });
    if (spot!.owner.id !== user.id) throw new ForbiddenException('只能登记自己车位的回家');
    const at = dto.at ? new Date(dto.at) : new Date();
    slot.ownerReturnedAt = at;
    await this.slotRepo.save(slot);

    // 找在场/预约重叠的车主
    const reservation = await this.reservations
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.spot', 'rspot')
      .leftJoinAndSelect('rspot.community', 'rcomm')
      .leftJoinAndSelect('r.driver', 'rdriver')
      .leftJoinAndSelect('r.slot', 'rslot')
      .where('r.slot_id = :slotId', { slotId: slot.id })
      .andWhere('r.status IN (:...s)', { s: ['booked', 'dispatched'] })
      .andWhere('r.startTime < :at AND r.endTime > :at', { at })
      .getOne();

    let incident: Incident | null = null;
    let notice: MoveNotice | null = null;
    let dispatched: Reservation | null = null;

    if (reservation) {
      const session = await this.sessions.findOne({
        where: { reservation: { id: reservation.id } },
      });
      incident = await this.incidents.save(
        this.incidents.create({
          type: 'owner_return',
          status: 'open',
          spot: spot!,
          reservation,
          session,
          reportedBy: user,
          description: `业主于 ${at.toISOString()} 临时回家，早于共享时段结束，需通知车牌 ${reservation.plate} 挪车并夜间调度`,
          occurredAt: at,
        }),
      );
      notice = await this.notices.save(
        this.notices.create({
          plate: reservation.plate,
          incident,
          status: 'sent',
          sentAt: at,
          channel: 'App推送+短信',
        }),
      );
      await this.audit.record('owner', user.id, 'owner_return', 'incident', incident.id, {
        reservation: reservation.id,
        at: at.toISOString(),
      });

      // 自动调度改派（业主提前回家违约，结算按业主责任）
      dispatched = await this.dispatchReservationInternal(
        reservation,
        at,
        '业主提前回家，系统自动改派至同小区可用车位',
        undefined,
        { responsibility: 'owner', driverShare: 0, ownerReturnedEarly: true },
      );
    }

    return { slotId: slot.id, ownerReturnedAt: at, incidentId: incident?.id ?? null, notice: notice ?? null, dispatched: dispatched ? this.shapeReservation(dispatched, null) : null };
  }

  async dispatchReservationInternal(
    reservation: Reservation,
    fromAt: Date,
    note: string,
    targetSlotId?: string,
    liability?: { responsibility: any; driverShare: number; ownerReturnedEarly?: boolean },
  ): Promise<Reservation | null> {
    const target = targetSlotId
      ? await this.slotRepo.findOne({ where: { id: targetSlotId }, relations: { spot: true } })
      : await this.findAlternativeSlot(reservation, fromAt);
    if (!target) {
      reservation.status = 'evicted';
      reservation.dispatchNote = `${note}；同小区无可用替代车位，订单清退待结算`;
      await this.reservations.save(reservation);
      const inc = await this.incidents.findOne({
        where: { reservation: { id: reservation.id }, type: 'owner_return' },
        order: { occurredAt: 'DESC' },
      });
      if (inc) {
        inc.status = 'resolved';
        inc.resolvedAt = new Date();
        inc.resolution = { action: 'evict', note: reservation.dispatchNote };
        await this.incidents.save(inc);
      }
      await this.audit.record('system', null, 'reservation_evict', 'reservation', reservation.id, {});
      return null;
    }
    const targetSpot = await this.spots.findOne({ where: { id: target.spot.id } });
    const nr = this.reservations.create({
      plate: reservation.plate,
      vehicleType: reservation.vehicleType,
      isVisitor: reservation.isVisitor,
      driver: reservation.driver,
      spot: targetSpot!,
      slot: target,
      startTime: fromAt,
      endTime: reservation.endTime,
      status: 'booked',
      estimatedFee: reservation.estimatedFee,
      dispatchNote: note,
    });
    const saved = await this.reservations.save(nr);
    reservation.status = 'dispatched';
    reservation.dispatchedTo = saved;
    reservation.dispatchNote = note;
    await this.reservations.save(reservation);

    // 旧会话若在场则强制关闭，并对已实际停放的时段立即结算（挪车后在新车位重新入场）
    const oldSession = await this.sessions.findOne({
      where: { reservation: { id: reservation.id } },
    });
    if (oldSession && oldSession.status === 'in') {
      oldSession.status = 'force_closed';
      oldSession.exitTime = fromAt;
      await this.sessions.save(oldSession);
      await this.settleClosedSession(oldSession, reservation, fromAt, {
        responsibility: liability?.responsibility ?? 'none',
        driverShare: liability?.driverShare ?? 1,
        ownerReturnedEarly: liability?.ownerReturnedEarly ?? false,
        evicted: true,
        trigger: 'dispatch',
      });
    }

    const inc = await this.incidents.findOne({
      where: { reservation: { id: reservation.id } },
      order: { occurredAt: 'DESC' },
    });
    if (inc) {
      inc.status = 'resolved';
      inc.resolvedAt = new Date();
      inc.resolution = {
        action: 'dispatch',
        toSpot: targetSpot!.code,
        newReservation: saved.id,
        note,
      };
      await this.incidents.save(inc);
    }
    await this.audit.record('system', null, 'reservation_dispatch', 'reservation', saved.id, {
      from: reservation.id,
      spot: targetSpot!.code,
    });
    return saved;
  }

  private async findAlternativeSlot(r: Reservation, fromAt: Date): Promise<ShareSlot | null> {
    const communityId = r.spot.community.id;
    const sameNightDate = r.slot.date;
    const slots = await this.slotRepo
      .createQueryBuilder('sl')
      .leftJoinAndSelect('sl.spot', 'sp')
      .where('sp.community_id = :cid', { cid: communityId })
      .andWhere('sp.approvalStatus = :ok', { ok: 'approved' })
      .andWhere('sp.active = true')
      .andWhere('sp.id != :sid', { sid: r.spot.id })
      .andWhere('sl.closed = false')
      .andWhere('sl.date = :d', { d: sameNightDate })
      .getMany();

    for (const sl of slots) {
      const start = slotDateToDate(sl.date, sl.startMinute);
      const end = slotDateToDate(sl.date, sl.endMinute);
      if (fromAt < start || r.endTime > end) continue;
      if (r.isVisitor && !sl.spot.allowVisitor) continue;
      if (r.vehicleType === 'fuel' && sl.spot.isChargerSpot) continue;
      // 冲突校验
      const conflict = await this.reservations
        .createQueryBuilder('rr')
        .where('rr.slot_id = :slid', { slid: sl.id })
        .andWhere('rr.status IN (:...s)', { s: ['booked', 'dispatched'] })
        .andWhere('rr.startTime < :end AND rr.endTime > :start', { start: fromAt, end: r.endTime })
        .getOne();
      if (!conflict) return sl;
    }
    return null;
  }

  async dispatch(user: any, dto: DispatchDto) {
    const r = await this.reservations.findOne({ where: { id: dto.reservationId } });
    if (!r) throw new NotFoundException('预约不存在');
    if (r.status !== 'booked' && r.status !== 'dispatched')
      throw new BadRequestException('该预约当前状态不可改派');
    const saved = await this.dispatchReservationInternal(
      r,
      dto.at ? new Date(dto.at) : new Date(),
      dto.note || '物业夜间人工调度改派',
      dto.targetSlotId,
      // 人工调度多因陌生占位/异常：按陌生车责任豁免车主并补偿
      { responsibility: 'stranger', driverShare: 0 },
    );
    return saved ? this.getReservation(saved.id) : { evicted: true };
  }

  async reportIncident(user: any, dto: ReportIncidentDto) {
    const spot = await this.spots.findOne({ where: { id: dto.spotId } });
    if (!spot) throw new NotFoundException('车位不存在');
    const at = dto.at ? new Date(dto.at) : new Date();
    let reservation = dto.reservationId
      ? await this.reservations.findOne({ where: { id: dto.reservationId } })
      : await this.findReservationAtSpot(spot.id, at);
    let session = reservation
      ? await this.sessions.findOne({ where: { reservation: { id: reservation.id } } })
      : null;

    const inc = this.incidents.create({
      type: dto.type as IncidentType,
      status: 'open',
      spot,
      reservation,
      session,
      involvedPlate: dto.involvedPlate ? normPlate(dto.involvedPlate) : null,
      reportedBy: user.id ? user : null,
      description: dto.description,
      occurredAt: at,
    });
    const saved = await this.incidents.save(inc);
    await this.audit.record(user.role || 'property', user.id || null, 'incident_open', 'incident', saved.id, {
      type: dto.type,
      spot: spot.code,
    });

    // 燃油车占用充电车位 / 访客超时：自动生成挪车通知
    if (
      (dto.type === 'fuel_on_charger' || dto.type === 'visitor_overtime') &&
      (dto.involvedPlate || reservation)
    ) {
      const plate = normPlate(dto.involvedPlate || reservation!.plate);
      await this.notices.save(
        this.notices.create({
          plate,
          incident: saved,
          status: 'sent',
          sentAt: at,
          channel: 'App推送+短信',
        }),
      );
    }
    return this.getIncident(saved.id);
  }

  private async findReservationAtSpot(spotId: string, at: Date): Promise<Reservation | null> {
    return this.reservations
      .createQueryBuilder('r')
      .where('r.spot_id = :spotId', { spotId })
      .andWhere('r.status IN (:...s)', { s: ['booked', 'dispatched'] })
      .andWhere('r.startTime <= :at AND r.endTime >= :at', { at })
      .getOne();
  }

  async listIncidents(status?: string, type?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    return this.incidents.find({
      where,
      order: { occurredAt: 'DESC' },
      relations: { moveNotices: true },
      take: 200,
    });
  }

  async getIncident(id: string) {
    const inc = await this.incidents.findOne({
      where: { id },
      relations: { moveNotices: true },
    });
    if (!inc) throw new NotFoundException('异常不存在');
    return inc;
  }

  async sendMoveNotice(user: any, incidentId: string, dto: MoveNoticeDto) {
    const incident = await this.incidents.findOne({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('异常不存在');
    const notice = await this.notices.save(
      this.notices.create({
        plate: normPlate(dto.plate),
        incident,
        status: 'sent',
        sentAt: dto.at ? new Date(dto.at) : new Date(),
        channel: dto.channel || 'App推送+短信',
      }),
    );
    incident.status = 'notified';
    await this.incidents.save(incident);
    await this.audit.record('property', user.id, 'move_notice_sent', 'incident', incident.id, {
      plate: dto.plate,
    });
    return notice;
  }

  async ackMoveNotice(user: any, noticeId: string, dto: NoticeAckDto) {
    const n = await this.notices.findOne({ where: { id: noticeId } });
    if (!n) throw new NotFoundException('通知不存在');
    if (dto.moved) {
      n.status = 'moved';
      n.movedAt = new Date();
    } else {
      n.status = 'acknowledged';
      n.acknowledgedAt = new Date();
    }
    await this.notices.save(n);
    if (dto.moved) {
      const inc = await this.incidents.findOne({ where: { id: n.incident.id } });
      if (inc && inc.status !== 'resolved') {
        inc.status = 'resolved';
        inc.resolvedAt = new Date();
        inc.resolution = { action: 'moved', plate: n.plate, at: n.movedAt!.toISOString() };
        await this.incidents.save(inc);
      }
    }
    return n;
  }

  async resolveIncident(user: any, id: string, dto: ResolveIncidentDto) {
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw new NotFoundException('异常不存在');
    inc.status = 'closed';
    inc.resolvedAt = new Date();
    inc.resolution = { ...(inc.resolution ?? {}), manual: true, note: dto.note ?? null };
    await this.incidents.save(inc);
    await this.audit.record('property', user.id, 'incident_close', 'incident', id, dto);
    return inc;
  }

  async patrol(user: any, dto: PatrolDto) {
    const spot = await this.spots.findOne({ where: { id: dto.spotId } });
    if (!spot) throw new NotFoundException('车位不存在');
    const at = dto.at ? new Date(dto.at) : new Date();
    const plate = dto.plate ? normPlate(dto.plate) : null;
    const record = await this.patrols.save(
      this.patrols.create({
        spot,
        inspector: user,
        plate,
        note: dto.note ?? null,
        at,
      }),
    );
    await this.audit.record('property', user.id, 'patrol', 'spot', spot.id, {
      plate,
      note: dto.note ?? null,
    });

    // 巡查发现预约车位被陌生车占用 → 自动开异常单；并校正在场车辆的实际车位
    let autoIncident: Incident | null = null;
    if (plate) {
      // 物理发现：把在场会话的实际车位校正为巡查车位（用于错停判定与占用时间线）
      const activeSession = await this.sessions.findOne({
        where: { plate, status: 'in' },
        order: { entryTime: 'DESC' },
      });
      if (activeSession && activeSession.actualSpot.id !== spot.id) {
        const fromCode = activeSession.actualSpot.code;
        activeSession.actualSpot = spot;
        await this.sessions.save(activeSession);
        await this.audit.record('property', user.id, 'session_actual_spot_corrected', 'session', activeSession.id, {
          from: fromCode, to: spot.code, plate,
        });
      }

      const reservation = await this.findReservationAtSpot(spot.id, at);
      if (reservation && reservation.plate !== plate) {
        const openOne = await this.incidents.findOne({
          where: { spot: { id: spot.id }, type: 'stranger_occupation', status: In(['open', 'notified']) },
        });
        if (!openOne) {
          autoIncident = await this.incidents.save(
            this.incidents.create({
              type: 'stranger_occupation',
              status: 'open',
              spot,
              reservation,
              involvedPlate: plate,
              reportedBy: user,
              description: `物业巡查发现预约车位 ${spot.code} 被陌生车辆 ${plate} 占用（预约车牌 ${reservation.plate}）`,
              occurredAt: at,
            }),
          );
        }
      }
    }
    return { patrol: record, autoIncident };
  }

  listPatrols() {
    return this.patrols.find({ order: { at: 'DESC' }, take: 200 });
  }

  // 陌生占位车追缴：生成占位违约金订单（参与当晚分账：平台 60% / 物业 40%）
  async chargeStranger(user: any, incidentId: string, dto?: { at?: string }) {
    const inc = await this.incidents.findOne({ where: { id: incidentId } });
    if (!inc) throw new NotFoundException('异常不存在');
    if (!inc.involvedPlate) throw new BadRequestException('该异常未登记涉事车牌，无法追缴');
    const plate = inc.involvedPlate;
    const at = dto?.at ? new Date(dto.at) : new Date();

    const exist = await this.orders.findOne({
      where: { incident: { id: inc.id }, kind: 'stranger_penalty' },
    });
    if (exist) throw new BadRequestException('该异常已生成追缴单');

    const { computeBilling } = await import('../../common/billing');
    const community = await this.communities.findOne({ where: { id: inc.spot.community.id } });
    const billing = computeBilling({
      entry: inc.occurredAt,
      exit: at,
      reservedStart: new Date(at.getTime() + 3600000),
      reservedEnd: new Date(at.getTime() + 2 * 3600000),
      hourlyRate: community!.hourlyRate,
      nightlyCap: community!.nightlyCap,
      overtimeMultiplier: community!.overtimeMultiplier,
      moveGraceMinutes: community!.moveGraceMinutes,
      noticeSentAt: null,
      responsibility: 'none',
      driverShare: 0,
      strangerPenalty: true,
    });

    const order = await this.orders.save(
      this.orders.create({
        plate,
        kind: 'stranger_penalty',
        status: 'paid',
        reservation: null,
        session: null,
        spot: inc.spot,
        incident: inc,
        baseFee: 0,
        overtimeFee: 0,
        moveDelayPenalty: 0,
        strangerPenalty: billing.strangerPenalty,
        couponDiscount: 0,
        abnormalCompensation: 0,
        ownerCompensation: 0,
        extraCharges: 0,
        responsibility: 'stranger',
        payable: billing.payable,
        paid: billing.payable,
        paidAt: at,
        refund: 0,
      }),
    );
    inc.status = 'resolved';
    inc.resolvedAt = at;
    inc.resolution = { ...(inc.resolution ?? {}), chargedOrder: order.id, amount: billing.payable };
    await this.incidents.save(inc);
    await this.audit.record('property', user.id, 'stranger_charge', 'order', order.id, {
      plate, spot: inc.spot.code, amount: billing.payable,
    });
    return order;
  }

  // ---------------- 优惠券 ----------------

  async listCoupons(user: any) {
    return this.coupons.find({
      where: user.role === 'driver' ? { owner: { id: user.id } } : {},
      order: { createdAt: 'DESC' },
    });
  }
}

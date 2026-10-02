import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { round2 } from '../../common/enums';
import { fmtClock } from '../../common/time';
import { Community } from '../../entities/community.entity';
import { ParkingSpot } from '../../entities/parking-spot.entity';
import { Reservation } from '../../entities/reservation.entity';
import { ParkingSession } from '../../entities/parking-session.entity';
import { Order } from '../../entities/order.entity';
import { Settlement } from '../../entities/settlement.entity';
import { SettlementItem } from '../../entities/settlement-item.entity';
import { Incident } from '../../entities/incident.entity';
import { AuditService } from './audit.service';

const RESP_LABEL: Record<string, string> = {
  driver: '车主违约',
  owner: '业主违约',
  platform_navigation: '平台导航责任',
  property: '物业责任',
  stranger: '陌生车辆占位',
  none: '正常/无单方违约',
};

@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(ParkingSpot) private readonly spots: Repository<ParkingSpot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(ParkingSession) private readonly sessions: Repository<ParkingSession>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Settlement) private readonly settlements: Repository<Settlement>,
    @InjectRepository(SettlementItem) private readonly items: Repository<SettlementItem>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    private readonly audit: AuditService,
  ) {}

  // 按小区 + 夜间日期合并清算
  async runSettlement(user: any, communityId: string, date: string) {
    const community = await this.communities.findOne({ where: { id: communityId } });
    if (!community) throw new NotFoundException('小区不存在');

    const orders = await this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.reservation', 'r')
      .leftJoinAndSelect('r.slot', 'sl')
      .leftJoinAndSelect('r.spot', 'sp')
      .leftJoinAndSelect('sp.community', 'spc')
      .leftJoinAndSelect('sp.owner', 'spo')
      .leftJoinAndSelect('r.driver', 'rd')
      .leftJoinAndSelect('o.spot', 'osp')
      .leftJoinAndSelect('osp.community', 'ospc')
      .leftJoinAndSelect('osp.owner', 'ispo')
      .leftJoinAndSelect('o.session', 'osess')
      .where('(spc.id = :cid OR ospc.id = :cid)', { cid: communityId })
      .andWhere(
        '(sl.date = :date OR (sl.id IS NULL AND DATE(COALESCE(osess.entryTime, o.paidAt)) = :date))',
        { date },
      )
      .getMany();

    if (!orders.length) throw new BadRequestException(`${date} 该小区夜间暂无订单可清算`);

    // 幂等：重建明细
    const existing = await this.settlements.findOne({ where: { community: { id: communityId }, date } });
    if (existing) {
      await this.items.delete({ settlement: { id: existing.id } });
      await this.settlements.delete(existing.id);
    }

    const settlement = await this.settlements.save(
      this.settlements.create({ community, date, status: 'draft' }),
    );

    const totals = {
      totalCollected: 0,
      totalRefund: 0,
      totalCoupon: 0,
      totalCompensation: 0,
      ownerPayout: 0,
      propertyFee: 0,
      platformFee: 0,
    };
    const ownerTotals: Record<string, { name: string; amount: number }> = {};
    const spotTimeline: Record<string, any[]> = {};

    // 预先加载会话
    const sessions = orders.length
      ? await this.sessions.find({
          where: { reservation: In(orders.map((o) => o.reservation?.id).filter(Boolean) as string[]) },
        })
      : [];
    const sessionByRes = new Map(sessions.map((s) => [s.reservation.id, s]));

    for (const order of orders) {
      const r = order.reservation ?? null;
      const reservedSpot = r?.spot ?? null;
      const session = r
        ? sessionByRes.get(r.id) ?? null
        : order.session ?? null;
      // 明细车位取实际停放车位（巡查可校正错停），无会话时回退到预约车位/追缴单车位
      const spot = session?.actualSpot ?? reservedSpot ?? order.spot;
      const driver = r?.driver ?? null;
      if (!spot) continue;

      // 该笔订单实际覆盖的时间段（同晚多单时逐段切分）
      const segmentStart = session?.entryTime ?? r?.startTime ?? order.paidAt ?? new Date();
      const segmentEnd = session?.exitTime ?? r?.endTime ?? order.paidAt ?? segmentStart;

      // 分成基数取最终费用分项（申诉改判后这些字段已是最终值；
      // 退款冲减实收、少缴追缴已计入相应费用字段，此处不再重复加减）
      const grossParking = round2(
        order.baseFee + order.overtimeFee + order.moveDelayPenalty,
      );
      const platformFeeRaw = round2(grossParking * community.platformRate);
      const propertyFeeRaw = round2(grossParking * community.propertyRate);
      let ownerRevenue = round2(grossParking - platformFeeRaw - propertyFeeRaw);
      let platformAmount = platformFeeRaw;
      let propertyAmount = propertyFeeRaw;

      // 优惠券由平台营销承担（业主收益不受影响）
      platformAmount = round2(platformAmount - order.couponDiscount);

      // 异常补偿按责任归属承担
      const comp = round2(order.abnormalCompensation);
      if (comp > 0) {
        if (order.responsibility === 'owner') ownerRevenue = round2(ownerRevenue - comp);
        else if (order.responsibility === 'property') propertyAmount = round2(propertyAmount - comp);
        else platformAmount = round2(platformAmount - comp);
      }

      // 车主错停赔给业主的补偿
      let ownerAmount = round2(ownerRevenue + order.ownerCompensation);

      // 陌生占位违约金：平台 60%（追偿/补偿池）、物业 40%（现场处置）
      if (order.strangerPenalty > 0) {
        platformAmount = round2(platformAmount + order.strangerPenalty * 0.6);
        propertyAmount = round2(propertyAmount + order.strangerPenalty * 0.4);
        ownerAmount = 0;
      }

      // 实付 = 已付 + 裁决后追缴 - 退款
      const paidByDriver = round2(
        Math.max(0, order.paid - order.refund) + (order.extraCharges ?? 0),
      );

      const item = await this.items.save(
        this.items.create({
          settlement,
          spot,
          reservation: r,
          order,
          driver,
          plate: order.plate,
          segmentStart,
          segmentEnd,
          ownerAmount,
          propertyAmount,
          platformAmount,
          couponAmount: order.couponDiscount,
          refundAmount: order.refund,
          compensationAmount: order.abnormalCompensation,
          responsibility: order.responsibility as any,
          paidByDriver,
          note: this.buildNote(order, r?.status ?? 'stranger_penalty', segmentStart, segmentEnd),
        }),
      );

      totals.totalCollected = round2(totals.totalCollected + paidByDriver);
      totals.totalRefund = round2(totals.totalRefund + order.refund);
      totals.totalCoupon = round2(totals.totalCoupon + order.couponDiscount);
      totals.totalCompensation = round2(totals.totalCompensation + order.abnormalCompensation);
      totals.ownerPayout = round2(totals.ownerPayout + ownerAmount);
      totals.propertyFee = round2(totals.propertyFee + propertyAmount);
      totals.platformFee = round2(totals.platformFee + platformAmount);

      const ownerKey = spot.owner.id;
      if (!ownerTotals[ownerKey]) ownerTotals[ownerKey] = { name: spot.owner.displayName, amount: 0 };
      ownerTotals[ownerKey].amount = round2(ownerTotals[ownerKey].amount + ownerAmount);

      const key = spot.code;
      (spotTimeline[key] ||= []).push({
        itemId: item.id,
        plate: order.plate,
        driver: driver?.displayName ?? '陌生车辆（无预约）',
        from: segmentStart.toISOString(),
        to: segmentEnd.toISOString(),
        clock: `${fmtClock(segmentStart)}–${fmtClock(segmentEnd)} UTC`,
        paidByDriver,
        ownerAmount,
        propertyAmount,
        platformAmount,
        responsibility: order.responsibility,
        responsibilityLabel: RESP_LABEL[order.responsibility] ?? order.responsibility,
        status: r?.status ?? 'stranger_penalty',
        note: item.note,
      });
    }

    // 同晚无订单的异常（如陌生占位未追缴）写入备注
    const openIncidents = await this.incidents
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.spot', 'sp')
      .where('sp.community_id = :cid', { cid: communityId })
      .andWhere('DATE(i.occurredAt) = :date', { date })
      .getMany();

    settlement.totalCollected = totals.totalCollected;
    settlement.totalRefund = totals.totalRefund;
    settlement.totalCoupon = totals.totalCoupon;
    settlement.totalCompensation = totals.totalCompensation;
    settlement.ownerPayout = totals.ownerPayout;
    settlement.propertyFee = totals.propertyFee;
    settlement.platformFee = totals.platformFee;
    settlement.status = 'settled';
    settlement.settledAt = new Date();
    settlement.breakdown = {
      rates: {
        platformRate: community.platformRate,
        propertyRate: community.propertyRate,
      },
      ownerTotals,
      spotTimeline,
      untrackedIncidents: openIncidents
        .filter((i) => i.type === 'stranger_occupation')
        .map((i) => ({
          spot: i.spot.code,
          plate: i.involvedPlate,
          status: i.status,
          note: '陌生车辆违约金待物业线下追缴，不参与本次线上分账',
        })),
      moneyIdentityNote:
        '业主收益 + 物业服务费 + 平台抽成 = 车主实付（优惠券由平台承担、异常补偿按责任扣减）',
    };
    await this.settlements.save(settlement);

    await this.audit.record(user?.role ?? 'admin', user?.id ?? null, 'settle_night', 'settlement', settlement.id, {
      community: community.name,
      date,
      orders: orders.length,
      ...totals,
    });

    return this.getSettlement(settlement.id);
  }

  private buildNote(order: Order, resStatus: string, start: Date, end: Date): string {
    const parts: string[] = [];
    parts.push(
      `${fmtClock(start)}–${fmtClock(end)} UTC 由车牌 ${order.plate} 实际使用，车主支付 ${round2(
        Math.max(0, order.paid - order.refund),
      )} 元`,
    );
    if (order.baseFee) parts.push(`基础停车费 ${order.baseFee}`);
    if (order.overtimeFee) parts.push(`超时费 ${order.overtimeFee}`);
    if (order.moveDelayPenalty) parts.push(`挪车迟延违约金 ${order.moveDelayPenalty}`);
    if (order.strangerPenalty) parts.push(`占位违约金 ${order.strangerPenalty}`);
    if (order.ownerCompensation) parts.push(`车主补偿业主 ${order.ownerCompensation}`);
    if (order.couponDiscount) parts.push(`优惠券抵扣 ${order.couponDiscount}（平台承担）`);
    if (order.abnormalCompensation) parts.push(`异常补偿 ${order.abnormalCompensation}（责任方承担）`);
    if (order.refund) parts.push(`申诉退款 ${order.refund}`);
    if (order.extraCharges > 0) parts.push(`裁决后少缴追缴 ${order.extraCharges}`);
    parts.push(`违约归属：${RESP_LABEL[order.responsibility] ?? order.responsibility}`);
    if (resStatus === 'dispatched') parts.push('该预约经夜间调度改派，本时段按实际占用切分');
    if (resStatus === 'evicted') parts.push('业主提前回家，车主被清退，按实际停放计费');
    return parts.join('；');
  }

  list() {
    return this.settlements.find({ order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async getSettlement(id: string) {
    const s = await this.settlements.findOne({ where: { id } });
    if (!s) throw new NotFoundException('分账批次不存在');
    const items = await this.items.find({
      where: { settlement: { id } },
      order: { segmentStart: 'ASC' },
    });
    return { ...s, items };
  }

  // 同一车位某晚的时间线（未清算也可查看，直接从订单/预约解释）
  async spotTimeline(spotId: string, date?: string) {
    const spot = await this.spots.findOne({ where: { id: spotId } });
    if (!spot) throw new NotFoundException('车位不存在');
    const reservations = await this.reservations.find({
      where: { spot: { id: spotId } },
      order: { startTime: 'ASC' },
      take: 200,
    });
    const sessions = await this.sessions.find({
      where: { actualSpot: { id: spotId } },
      order: { entryTime: 'ASC' },
      take: 200,
    });
    const orders = await this.orders.find({
      where: { session: In(sessions.map((s) => s.id)) },
    });
    const orderBySession = new Map(orders.map((o) => [o.session?.id, o]));

    const segments = sessions.map((s) => {
      const order = orderBySession.get(s.id);
      return {
        plate: s.plate,
        from: s.entryTime.toISOString(),
        to: (s.exitTime ?? new Date()).toISOString(),
        clock: `${fmtClock(s.entryTime)}–${s.exitTime ? fmtClock(s.exitTime) : '在库'} UTC`,
        status: s.status,
        entryMatchType: s.entryMatchType,
        billing: s.billing,
        order: order
          ? {
              id: order.id,
              payable: order.payable,
              paid: order.paid,
              refund: order.refund,
              responsibility: order.responsibility,
            }
          : null,
      };
    });

    return {
      spot: {
        id: spot.id,
        code: spot.code,
        zone: spot.zone,
        community: spot.community.name,
        owner: spot.owner.displayName,
      },
      date: date ?? null,
      reservations: reservations.map((r) => ({
        id: r.id,
        plate: r.plate,
        from: r.startTime.toISOString(),
        to: r.endTime.toISOString(),
        status: r.status,
      })),
      occupiedSegments: segments,
    };
  }
}

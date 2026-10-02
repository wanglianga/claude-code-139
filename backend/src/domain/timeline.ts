// 车位一晚时间轴：把同一晚同一车位的多个预约、入场离场事件、异常工单与分账
// 切成互不重叠的时间段，解释每段"谁在使用、谁付款、谁承担违约"。

import { Ruling } from './pricing';

export interface TimelineOrder {
  id: number;
  code: string;
  driverName: string;
  plate: string;
  status: string;
  reservedStart: Date;
  reservedEnd: Date;
  gateEntryAt: Date | null;
  parkingConfirmedAt: Date | null;
  gateExitAt: Date | null;
  usableFrom?: Date | null;
  settlement?: {
    ruling: Ruling | null;
    baseFee: number;
    overtimeFee: number;
    wrongParkFine: number;
    abnormalCompensation: number;
    payable: number;
  } | null;
}

export interface TimelineIncident {
  id: number;
  type: string;
  status: string;
  plate: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  reservationId: number | null;
}

export interface TimelineSegment {
  from: Date;
  to: Date;
  minutes: number;
  occupant: string; // 人类可读：使用方
  occupantKind: 'driver' | 'owner' | 'stranger' | 'idle' | 'gap';
  reservationId: number | null;
  plate: string | null;
  status: string; // 在该时段的状态（使用中/等待入场/被异常占用/空档）
  payer: string; // 谁支付
  liability: string; // 谁承担违约
  note: string;
}

const INCIDENT_LABEL: Record<string, string> = {
  owner_return: '业主临时回家',
  visitor_overstay: '访客车辆超时',
  stranger_occupy: '陌生车辆占用',
  recognition_fail: '道闸识别失败',
  weak_signal: '地下车库信号差',
  ice_occupy_charger: '燃油车占用充电位',
  wrong_parking: '车主停错车位',
  manual_release: '物业人工放行',
};

const RULING_LABEL: Record<string, string> = {
  driver_fault: '车主责任',
  owner_fault: '业主责任',
  platform_fault: '平台责任',
  property_fault: '物业责任',
  stranger: '陌生车主责任（平台兜底后追缴）',
  mixed: '混合责任',
  no_fault: '无责',
};

const min = (d?: Date | null) => (d ? d.getTime() : Infinity);

/**
 * 构建一晚时间轴。nightStart/nightEnd 为当晚边界（如 18:00 ~ 次日 09:00）。
 */
export function buildSpotTimeline(
  nightStart: Date,
  nightEnd: Date,
  orders: TimelineOrder[],
  incidents: TimelineIncident[],
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const sorted = [...orders].sort((a, b) => a.reservedStart.getTime() - b.reservedStart.getTime());

  // 1) 每个订单的实际占用区间（入场确认 -> 离场），以及预约但未入场的等待区间
  const occupancy: Array<{
    from: number;
    to: number;
    order: TimelineOrder;
    kind: 'using' | 'waiting' | 'overstay';
  }> = [];

  for (const o of sorted) {
    if (o.status === 'cancelled') continue;
    const entry = o.usableFrom ?? o.parkingConfirmedAt ?? o.gateEntryAt;
    const exit = o.gateExitAt ?? (o.status === 'completed' ? o.reservedEnd : null);

    // 预约开始 ~ 实际可使用：可能在等待（被陌生车占/识别失败），也可能未到（空档，由后续 gap 合并）
    if (entry && new Date(entry) > o.reservedStart) {
      occupancy.push({
        from: o.reservedStart.getTime(),
        to: Math.min(new Date(entry).getTime(), o.reservedEnd.getTime()),
        order: o,
        kind: 'waiting',
      });
    }
    if (entry && exit) {
      occupancy.push({
        from: new Date(entry).getTime(),
        to: Math.max(new Date(entry).getTime(), new Date(exit).getTime()),
        order: o,
        kind: new Date(exit) > o.reservedEnd ? 'overstay' : 'using',
      });
    } else if (entry && !exit) {
      occupancy.push({
        from: new Date(entry).getTime(),
        to: Math.max(o.reservedEnd.getTime(), new Date(entry).getTime()),
        order: o,
        kind: 'using',
      });
    } else if (!entry && o.status !== 'noshow') {
      // 尚未入场：按预约窗口展示为等待
      occupancy.push({
        from: o.reservedStart.getTime(),
        to: o.reservedEnd.getTime(),
        order: o,
        kind: 'waiting',
      });
    }
  }

  occupancy.sort((a, b) => a.from - b.from);

  // 2) 异常工单产生的占用/中断区间
  const incidentSpans = incidents
    .filter((i) => ['stranger_occupy', 'ice_occupy_charger', 'wrong_parking'].includes(i.type))
    .map((i) => ({
      from: i.createdAt.getTime(),
      to: (i.resolvedAt ?? nightEnd).getTime(),
      incident: i,
    }))
    .sort((a, b) => a.from - b.from);

  // 3) 合并生成时间轴：以所有分界点切分当晚
  const nightFrom = nightStart.getTime();
  const nightTo = nightEnd.getTime();
  const cuts = new Set<number>([nightFrom, nightTo]);
  for (const s of occupancy) {
    cuts.add(Math.max(nightFrom, s.from));
    cuts.add(Math.min(nightTo, s.to));
  }
  for (const s of incidentSpans) {
    cuts.add(Math.max(nightFrom, s.from));
    cuts.add(Math.min(nightTo, s.to));
  }
  const points = [...cuts].filter((t) => t >= nightFrom && t <= nightTo).sort((a, b) => a - b);

  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k];
    const to = points[k + 1];
    if (to - from < 60000) continue;

    const spanIncidents = incidentSpans.filter((s) => s.from < to && s.to > from);
    const spanOcc = occupancy.find((s) => s.from < to && s.to > from);

    let occupant = '空档';
    let occupantKind: TimelineSegment['occupantKind'] = 'idle';
    let reservationId: number | null = null;
    let plate: string | null = null;
    let status = '未共享 / 无预约';
    let payer = '—';
    let liability = '—';
    let note = '';

    const stranger = spanIncidents.find(
      (s) => s.incident.type === 'stranger_occupy' || s.incident.type === 'ice_occupy_charger',
    );
    const wrong = spanIncidents.find((s) => s.incident.type === 'wrong_parking');

    if (stranger) {
      occupant = `陌生车 ${stranger.incident.plate ?? '（车牌待核）'}`;
      occupantKind = 'stranger';
      plate = stranger.incident.plate;
      reservationId = stranger.incident.reservationId;
      status = '车位被异常占用';
      payer = '预约车主照常计费，平台兜底';
      liability = '陌生车主（平台先行赔付后追缴）';
      note = stranger.incident.type === 'ice_occupy_charger'
        ? '燃油车占用充电车位，物业巡查通知挪车'
        : '陌生车辆占用已预约车位';
    } else if (wrong && spanOcc) {
      occupant = `${spanOcc.order.driverName}（停错车位）`;
      occupantKind = 'driver';
      reservationId = spanOcc.order.id;
      plate = spanOcc.order.plate;
      status = '错停占用';
      payer = `${spanOcc.order.driverName} 支付错停违约金 + 超时费`;
      liability = RULING_LABEL[spanOcc.order.settlement?.ruling ?? 'driver_fault'];
      note = INCIDENT_LABEL.wrong_parking;
    } else if (spanOcc) {
      const o = spanOcc.order;
      const rulingLabel = o.settlement?.ruling ? RULING_LABEL[o.settlement.ruling] : null;
      if (spanOcc.kind === 'waiting') {
        occupant = `${o.driverName}（待入场）`;
        occupantKind = 'gap';
        status = '预约生效但未实际占用（入场受阻）';
        payer = '该时段不计基础停车费';
        liability = rulingLabel ?? '待申诉裁决';
        note = '识别失败/信号差/被占用导致等待，依据证据链归责';
      } else {
        occupant = `${o.driverName}`;
        occupantKind = 'driver';
        status = spanOcc.kind === 'overstay' ? '访客超时使用中' : '正常使用中';
        payer = `${o.driverName} 按预约计费`;
        liability = rulingLabel ?? (spanOcc.kind === 'overstay' ? '车主承担超时费' : '无违约');
        note = spanOcc.kind === 'overstay' ? INCIDENT_LABEL.visitor_overstay : '';
      }
      reservationId = o.id;
      plate = o.plate;
    }

    // 业主回家区间
    const ownerReturn = incidents.find(
      (i) =>
        i.type === 'owner_return' &&
        i.createdAt.getTime() < to &&
        (i.resolvedAt ?? nightEnd).getTime() > from,
    );
    if (ownerReturn && !stranger) {
      occupant = '业主本人（临时回家）';
      occupantKind = 'owner';
      status = '共享中断，业主收回车位自用';
      payer = '车主按实际可用时长结算，已付差额退还';
      liability = '业主违约，补偿车主';
      note = ownerReturn.resolution ?? '平台发送挪车通知协调下一预约';
      reservationId = ownerReturn.reservationId;
    }

    // 人工放行事件标注（不改变占用方）
    const manual = incidents.find(
      (i) =>
        i.type === 'manual_release' &&
        i.createdAt.getTime() >= from &&
        i.createdAt.getTime() <= to,
    );
    if (manual) {
      note = [note, '物业人工放行（核对预约/车牌后开闸）'].filter(Boolean).join('；');
    }

    if (!spanOcc && !stranger && !ownerReturn) {
      // 判断该空档是否在某个已审核共享窗口内
      status = '可共享空档';
    }

    segments.push({
      from: new Date(from),
      to: new Date(to),
      minutes: Math.round((to - from) / 60000),
      occupant,
      occupantKind,
      reservationId,
      plate,
      status,
      payer,
      liability,
      note,
    });
  }

  return segments;
}

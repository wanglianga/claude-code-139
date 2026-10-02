import { round2, Responsibility } from './enums';
import { minutesBetween } from './time';

// 错停申诉责任判定引擎
// 证据来源：车牌识别(ANPR)、预约记录、现场照片、道闸日志、业主回家时间、物业巡查记录
// 输出：责任归属、车主承担比例、信用影响、可追溯的推理链 findings。

export interface AnprFact {
  plate: string | null; // 识别车牌号（识别失败为 null）
  confidence: number; // 0~1
  at: Date;
  matchType: 'matched' | 'failed' | 'manual' | 'unknown';
  note?: string | null;
}

export interface PhotoFact {
  at: Date;
  spotCode: string; // 照片拍摄车位
  plate: string | null; // 照片中车辆车牌
  kind: 'wrong_park' | 'stranger' | 'fuel_on_charger' | 'scene' | 'nav_screen';
  note?: string | null;
}

export interface PatrolFact {
  at: Date;
  spotCode: string; // 巡查车位
  plate: string | null; // 现场车牌
  note?: string | null;
}

export interface LiabilityInput {
  plate: string; // 申诉车牌
  reservedSpotCode: string;
  actualSpotCode: string | null; // 实际停放车位（道闸/巡查/照片确认）
  reservedStart: Date;
  reservedEnd: Date;
  entry: Date | null;
  exit: Date | null;
  vehicleType: 'ev' | 'fuel';
  reservedSpotIsCharger: boolean;
  actualSpotIsCharger: boolean;
  anprEntry: AnprFact | null;
  anprExit: AnprFact | null;
  photos: PhotoFact[];
  patrols: PatrolFact[];
  // 业主回家时间（null=未提前回家）
  ownerReturnedAt: Date | null;
  // 是否有夜间调度改派记录（平台把车主引导到了别的车位）
  platformDispatch?: { fromSpot: string; toSpot: string; at: Date; note?: string } | null;
  // 地下车库信号差是否被记录（影响挪车通知送达及时性）
  weakSignalRecorded?: boolean;
  // 挪车通知
  noticeSentAt: Date | null;
  noticeDelivered: boolean;
  // 车主陈述
  driverStatement?: string | null;
}

export interface LiabilityResult {
  responsibility: Responsibility;
  driverShare: number; // 0~1
  creditImpact: boolean;
  creditDelta: number; // 负数表示扣分
  status: 'upheld' | 'partial' | 'rejected';
  findings: { source: string; conclusion: string; weight: number }[];
  overtimeMinutes: number;
  moveDelayMinutes: number;
  reason: string;
}

// 识别置信度阈值
const ANPR_RELIABLE = 0.85;
const ANPR_LOW = 0.6;

export function determineLiability(input: LiabilityInput): LiabilityResult {
  const findings: { source: string; conclusion: string; weight: number }[] = [];
  const add = (source: string, conclusion: string, weight: number) =>
    findings.push({ source, conclusion, weight });

  const exit = input.exit;
  const overtimeMinutes =
    exit && exit.getTime() > input.reservedEnd.getTime()
      ? minutesBetween(input.reservedEnd, exit)
      : 0;

  let moveDelayMinutes = 0;
  if (input.noticeSentAt && input.noticeDelivered && exit) {
    const deadline = new Date(input.noticeSentAt.getTime() + 15 * 60000);
    if (exit.getTime() > deadline.getTime()) {
      moveDelayMinutes = minutesBetween(deadline, exit);
    }
  }

  // ---- 证据 1：预约记录 ----
  add(
    '预约记录',
    `车牌 ${input.plate} 预约车位 ${input.reservedSpotCode}，` +
      `时段 ${input.reservedStart.toISOString()} 至 ${input.reservedEnd.toISOString()}`,
    0.9,
  );

  // ---- 证据 2：道闸/车牌识别 ----
  if (input.anprEntry) {
    const a = input.anprEntry;
    if (a.matchType === 'matched' && a.plate === input.plate && a.confidence >= ANPR_RELIABLE) {
      add('入场车牌识别', `识别 ${a.plate}（置信度 ${a.confidence}）与预约一致，正常抬杆入场`, 0.9);
    } else if (a.matchType === 'failed' || a.confidence < ANPR_LOW) {
      add(
        '入场车牌识别',
        `识别失败/置信度过低（${a.confidence ?? 'null'}），转为人工核验`,
        0.6,
      );
    } else if (a.matchType === 'manual') {
      add('道闸日志', '车辆由物业人工放行入场，车牌未经自动核验', 0.5);
    }
  }
  if (input.anprExit) {
    const a = input.anprExit;
    add(
      '离场车牌识别',
      a.matchType === 'manual'
        ? '离场由物业人工放行'
        : `离场识别 ${a.plate ?? '未识别'}（置信度 ${a.confidence}）`,
      0.5,
    );
  }

  // ---- 证据 3：业主回家时间 ----
  const ownerReturnedEarly =
    !!input.ownerReturnedAt &&
    input.ownerReturnedAt.getTime() < input.reservedEnd.getTime();
  if (ownerReturnedEarly) {
    add(
      '业主回家记录',
      `业主于 ${input.ownerReturnedAt!.toISOString()} 提前回家，早于预约结束 ${minutesBetween(
        input.ownerReturnedAt!,
        input.reservedEnd,
      )} 分钟，违反 guaranteed 时段承诺`,
      0.95,
    );
  } else if (input.ownerReturnedAt) {
    add('业主回家记录', '业主在预约结束后回家，未违反共享时段承诺', 0.7);
  }

  // ---- 证据 4：物业巡查 ----
  const patrolOnReserved = input.patrols.find(
    (p) => p.spotCode === input.reservedSpotCode && p.plate && p.plate !== input.plate,
  );
  const patrolOnOther = input.patrols.find(
    (p) => p.spotCode !== input.reservedSpotCode && p.plate === input.plate,
  );
  if (patrolOnReserved) {
    add(
      '物业巡查',
      `${patrolOnReserved.at.toISOString()} 巡查发现预约车位 ${input.reservedSpotCode} 被陌生车辆 ${patrolOnReserved.plate} 占用`,
      0.95,
    );
  }
  if (patrolOnOther) {
    add(
      '物业巡查',
      `${patrolOnOther.at.toISOString()} 巡查发现申诉车辆停在 ${patrolOnOther.spotCode}，并非预约车位`,
      0.9,
    );
  }

  // ---- 证据 5：现场照片 ----
  const strangerPhoto = input.photos.find(
    (p) => p.spotCode === input.reservedSpotCode && p.plate && p.plate !== input.plate,
  );
  const driverWrongPhoto = input.photos.find(
    (p) => p.spotCode !== input.reservedSpotCode && p.plate === input.plate,
  );
  const navPhoto = input.photos.find((p) => p.kind === 'nav_screen');
  if (strangerPhoto) {
    add('现场照片', `照片显示预约车位被陌生车辆 ${strangerPhoto.plate} 占用`, 0.95);
  }
  if (driverWrongPhoto) {
    add('现场照片', `照片显示申诉车辆实际停放于 ${driverWrongPhoto.spotCode}`, 0.9);
  }
  if (navPhoto) {
    add('现场照片', `车主提供车机导航截图：${navPhoto.note ?? '导航指向存在偏差'}`, 0.6);
  }

  // ---- 证据 6：信号/通知 ----
  if (input.weakSignalRecorded) {
    add(
      '地下车库信号',
      '地下车库信号弱有工单记录，挪车通知送达可能延迟',
      0.55,
    );
  }
  if (input.noticeSentAt) {
    add(
      '挪车通知',
      `${input.noticeSentAt.toISOString()} 发送挪车通知，${
        input.noticeDelivered ? '已送达' : '未确认送达'
      }`,
      input.noticeDelivered ? 0.8 : 0.4,
    );
  }

  // ---- 判定 ----
  // 规则 1：业主在保证时段内提前回家 → 业主责任
  if (ownerReturnedEarly) {
    return result(
      'owner',
      0,
      false,
      0,
      'upheld',
      findings,
      overtimeMinutes,
      moveDelayMinutes,
      '业主在承诺的共享时段内提前回家，导致停车服务无法继续，车主申诉成立',
    );
  }

  // 规则 2：平台夜间调度把车辆改派过（无论最终停在哪）→ 平台导航责任
  if (input.platformDispatch) {
    add(
      '夜间调度记录',
      `平台于 ${input.platformDispatch.at.toISOString()} 将车辆从 ${input.platformDispatch.fromSpot} 改派至 ${input.platformDispatch.toSpot}：${input.platformDispatch.note ?? '调度引导'}`,
      0.9,
    );
    return result(
      'platform_navigation',
      0,
      false,
      0,
      'upheld',
      findings,
      overtimeMinutes,
      moveDelayMinutes,
      '停车服务由平台夜间调度改派，车主因此离开原预约车位，申诉成立',
    );
  }

  // 规则 3：预约车位在车主在场期间被陌生车辆占用，且车主实际未能停上该车位 → 陌生车责任
  const driverOnReserved = input.actualSpotCode === input.reservedSpotCode;
  const strangerEvents = [
    patrolOnReserved ? { at: patrolOnReserved.at } : null,
    strangerPhoto ? { at: strangerPhoto.at } : null,
  ].filter(Boolean) as { at: Date }[];
  const strangerBlockedDuringStay =
    !driverOnReserved &&
    strangerEvents.some(
      (e) =>
        (!input.entry || e.at.getTime() >= input.entry.getTime() - 5 * 60000) &&
        (!input.exit || e.at.getTime() <= input.exit.getTime()),
    );
  if (strangerBlockedDuringStay) {
    return result(
      'stranger',
      0,
      false,
      0,
      'upheld',
      findings,
      overtimeMinutes,
      moveDelayMinutes,
      '车主在场期间预约车位被陌生车辆占用（巡查/照片互证），车辆无法停入预约车位，申诉成立',
    );
  }

  // 规则 3：车主确实停在别的车位
  const parkedElsewhere =
    (input.actualSpotCode && input.actualSpotCode !== input.reservedSpotCode) ||
    !!patrolOnOther ||
    !!driverWrongPhoto;

  if (parkedElsewhere) {
    // 3b：入场识别失败 + 物业人工放行且未正确引导 → 物业责任
    const entryFailed =
      input.anprEntry &&
      (input.anprEntry.matchType === 'failed' ||
        input.anprEntry.matchType === 'manual' ||
        input.anprEntry.confidence < ANPR_LOW);
    if (entryFailed && !navPhoto) {
      add('责任推断', '自动识别失效后由人工放行，物业未将车辆引导至预约车位', 0.7);
      return result(
        'property',
        0,
        false,
        0,
        'upheld',
        findings,
        overtimeMinutes,
        moveDelayMinutes,
        '道闸识别失败后物业人工放行且引导失误，车主申诉成立',
      );
    }

    // 3c：燃油车占用充电车位（且无平台/物业引导证据）→ 车主责任，从重
    const fuelOnCharger =
      input.vehicleType === 'fuel' && input.actualSpotIsCharger;
    if (fuelOnCharger) {
      add('责任推断', '燃油车辆停放在充电车位，加剧错停影响（占用充电资源）', 0.8);
    }

    // 3d：信号差 + 通知未送达 + 车主有导航截图 → 混合责任
    if (input.weakSignalRecorded && !input.noticeDelivered && (navPhoto || !!input.driverStatement)) {
      add('责任推断', '信号弱导致通知延迟与导航偏差，同时车主未尽到核对车位义务', 0.6);
      const share = 0.5;
      return result(
        'none', // 混合：无单一他方，driverShare 表达比例
        share,
        true,
        -4,
        'partial',
        findings,
        overtimeMinutes,
        moveDelayMinutes,
        '信号/导航因素与车主未核对车位并存，申诉部分成立，车主承担 50%',
      );
    }

    // 3e：默认车主停错
    let credit = 0;
    if (moveDelayMinutes > 0) credit -= 10;
    else if (overtimeMinutes > 0) credit -= 6;
    else credit -= 4;
    add('责任推断', '无平台改派或物业误引证据，车辆实际车位与预约不符，车主未尽核对义务', 0.85);
    return result(
      'driver',
      1,
      true,
      credit,
      'rejected',
      findings,
      overtimeMinutes,
      moveDelayMinutes,
      fuelOnCharger
        ? '车主将燃油车停入非预约的充电车位，错停事实清楚，申诉驳回'
        : '车辆实际停放车位与预约不符且无第三方原因，车主确实停错，申诉驳回',
    );
  }

  // 规则 4：车位正确，仅超时争议
  if (overtimeMinutes > 0) {
    if (input.weakSignalRecorded && !input.noticeDelivered) {
      add('责任推断', '车位停放正确，超时系信号差导致通知未送达，酌情减轻', 0.6);
      return result(
        'none',
        0.5,
        true,
        -3,
        'partial',
        findings,
        overtimeMinutes,
        moveDelayMinutes,
        '停车位置无误但存在超时；信号差导致通知未达，申诉部分成立，车主承担 50%',
      );
    }
    add('责任推断', '车辆停放于预约车位但超过预约结束时间', 0.8);
    return result(
      'none',
      1,
      true,
      moveDelayMinutes > 0 ? -8 : -5,
      'rejected',
      findings,
      overtimeMinutes,
      moveDelayMinutes,
      '超时事实成立（车位无误，非错停），申诉驳回，按标准超时费结算',
    );
  }

  // 规则 5：无过错证据 → 申诉成立
  return result(
    'none',
    0,
    false,
    0,
    'upheld',
    findings,
    overtimeMinutes,
    moveDelayMinutes,
    '现有证据不能证明车主存在错停或超时，申诉成立',
  );
}

function result(
  responsibility: Responsibility,
  driverShare: number,
  creditImpact: boolean,
  creditDelta: number,
  status: 'upheld' | 'partial' | 'rejected',
  findings: { source: string; conclusion: string; weight: number }[],
  overtimeMinutes: number,
  moveDelayMinutes: number,
  reason: string,
): LiabilityResult {
  return {
    responsibility,
    driverShare: round2(driverShare),
    creditImpact,
    creditDelta,
    status,
    findings,
    overtimeMinutes,
    moveDelayMinutes,
    reason,
  };
}

import { round2, Responsibility } from './enums';
import { hoursBetween, maxDate, minutesBetween, overlapMinutes } from './time';

// 计费引擎：根据入场/离场、预约区间、挪车通知、责任判定与优惠券，
// 计算基础停车费、超时费、挪车迟延违约金、业主补偿、异常补偿与车主实付。

export interface BillingInput {
  entry: Date;
  exit: Date;
  reservedStart: Date;
  reservedEnd: Date;
  hourlyRate: number;
  nightlyCap: number;
  overtimeMultiplier: number; // 超时单价倍数
  moveGraceMinutes: number; // 挪车宽限
  noticeSentAt: Date | null; // 挪车通知
  responsibility: Responsibility; // 责任判定结果
  driverShare: number; // 0~1，车主承担比例
  ownerReturnedEarly?: boolean; // 业主是否在保证时段内提前回家
  evicted?: boolean; // 车主被清退/改派
  strangerPenalty?: boolean; // 陌生占位惩罚单
  couponAmount?: number;
  wrongParked?: boolean; // 车主确实停在非预约车位（混合责任时才计业主补偿）
}

export interface BillingResult {
  occupiedHours: number;
  normalHours: number;
  overtimeHours: number;
  moveDelayMinutes: number;
  baseFee: number; // 预约区间内停车费（夜间封顶后）
  rawBaseFee: number; // 封顶前
  overtimeFee: number;
  moveDelayPenalty: number;
  strangerPenalty: number;
  ownerCompensation: number; // 赔给业主（车主过错）
  abnormalCompensation: number; // 赔给车主（业主/平台/物业/陌生车过错，或混合责任豁免）
  couponDiscount: number;
  payable: number; // 车主应付
  explanation: string[];
}

// 挪车迟延违约金单价：基础时租的 2 倍
const MOVE_PENALTY_RATE = 2;
// 车主确实停错给业主的固定补偿
const WRONG_PARK_OWNER_COMP = 20;
// 业主提前回家（违约）赔给车主
const OWNER_EARLY_RETURN_COMP = 15;
// 平台/物业原因赔给车主
const PLATFORM_FAULT_COMP = 8;
// 陌生车占位违约金（向占位车追缴）
const STRANGER_PENALTY_FEE = 50;
// 陌生占位给受影响车主的补偿
const STRANGER_VICTIM_COMP = 12;

export function computeBilling(input: BillingInput): BillingResult {
  const explanation: string[] = [];
  const {
    entry,
    exit,
    reservedStart,
    reservedEnd,
    hourlyRate,
    nightlyCap,
    overtimeMultiplier,
    moveGraceMinutes,
    noticeSentAt,
  } = input;

  const occupiedHours = Math.max(0, hoursBetween(entry, exit));
  // 预约区间内的正常停放小时数
  const normalHours = overlapMinutes(entry, exit, reservedStart, reservedEnd) / 60;
  // 超出预约结束时间的小时数
  const overtimeFrom = maxDate(entry, reservedEnd);
  const overtimeHours =
    exit.getTime() > overtimeFrom.getTime() ? hoursBetween(overtimeFrom, exit) : 0;

  const rawBaseFee = round2(normalHours * hourlyRate);
  const baseFee = round2(Math.min(rawBaseFee, nightlyCap));
  if (rawBaseFee > nightlyCap) {
    explanation.push(`夜间封顶：正常时段费 ${rawBaseFee} 元按封顶价 ${nightlyCap} 元计收`);
  }

  // 全额（责任未分摊前）
  const overtimeFeeFull = round2(overtimeHours * hourlyRate * overtimeMultiplier);

  // 挪车迟延：通知送达 + 宽限期后仍未驶离；
  // 通知早于本次入场时间（如业主回家后车主已按调度改停）则与本场停车无关，忽略
  const effectiveNotice =
    noticeSentAt && noticeSentAt.getTime() > entry.getTime() ? noticeSentAt : null;
  let moveDelayMinutes = 0;
  if (effectiveNotice) {
    const deadline = new Date(effectiveNotice.getTime() + moveGraceMinutes * 60000);
    if (exit.getTime() > deadline.getTime()) {
      moveDelayMinutes = minutesBetween(deadline, exit);
    }
  }
  const moveDelayPenaltyFull = round2(
    (moveDelayMinutes / 60) * hourlyRate * MOVE_PENALTY_RATE,
  );

  let strangerPenalty = 0;
  let ownerCompensation = 0;
  let abnormalCompensation = 0;

  if (input.strangerPenalty) {
    strangerPenalty = STRANGER_PENALTY_FEE;
    explanation.push(
      `陌生车辆占用已共享车位，计收占位违约金 ${STRANGER_PENALTY_FEE} 元`,
    );
  }

  // 责任分摊：driverShare=1 车主全责；0<share<1 混合责任；=0 他方责任
  let overtimeFee: number;
  let moveDelayPenalty: number;
  const share = round2(input.driverShare);

  if (share >= 1) {
    overtimeFee = overtimeFeeFull;
    moveDelayPenalty = moveDelayPenaltyFull;
    if (input.responsibility === 'driver') {
      ownerCompensation = WRONG_PARK_OWNER_COMP;
      explanation.push(
        `裁决：车主全责，超时费/挪车违约金全额承担，补偿业主 ${WRONG_PARK_OWNER_COMP} 元`,
      );
    } else {
      explanation.push('正常离场结算：超时费按标准超时费率全额计收，无责任补偿');
    }
  } else if (share > 0) {
    overtimeFee = round2(overtimeFeeFull * share);
    moveDelayPenalty = round2(moveDelayPenaltyFull * share);
    ownerCompensation = input.wrongParked ? round2(WRONG_PARK_OWNER_COMP * share) : 0;
    const waived = round2(
      overtimeFeeFull - overtimeFee + (moveDelayPenaltyFull - moveDelayPenalty),
    );
    abnormalCompensation = waived; // 被豁免部分以异常补偿形式平账
    explanation.push(
      `裁决：混合责任，车主承担 ${Math.round(share * 100)}%，超时费 ${overtimeFee} 元、挪车违约金 ${moveDelayPenalty} 元，豁免 ${waived} 元`,
    );
  } else {
    overtimeFee = 0;
    moveDelayPenalty = 0;
    if (input.responsibility === 'owner') {
      abnormalCompensation = OWNER_EARLY_RETURN_COMP;
      explanation.push(
        `裁决：业主在保证时段内提前回家，豁免车主费用并补偿车主 ${OWNER_EARLY_RETURN_COMP} 元`,
      );
    } else if (input.responsibility === 'stranger') {
      abnormalCompensation = STRANGER_VICTIM_COMP;
      explanation.push(
        `裁决：陌生车辆占位责任，豁免车主费用并补偿 ${STRANGER_VICTIM_COMP} 元`,
      );
    } else if (
      input.responsibility === 'platform_navigation' ||
      input.responsibility === 'property'
    ) {
      abnormalCompensation = PLATFORM_FAULT_COMP;
      explanation.push(
        `裁决：${
          input.responsibility === 'property' ? '物业（道闸/信号/疏导）' : '平台导航派单'
        }责任，豁免车主费用并补偿 ${PLATFORM_FAULT_COMP} 元`,
      );
    } else {
      explanation.push('裁决：车主无责，超时费与挪车违约金豁免');
    }
  }

  if (input.evicted && input.ownerReturnedEarly) {
    explanation.push('业主提前回家触发清退，基础停车费仅按实际停放时段计收');
  }

  const couponDiscount = round2(
    Math.min(input.couponAmount ?? 0, baseFee + overtimeFee),
  );
  const gross = round2(
    baseFee +
      overtimeFee +
      moveDelayPenalty +
      strangerPenalty +
      ownerCompensation -
      couponDiscount -
      abnormalCompensation,
  );
  const payable = round2(Math.max(0, gross));

  explanation.push(
    `合计：基础 ${baseFee} + 超时 ${overtimeFee} + 挪车违约 ${moveDelayPenalty}` +
      (strangerPenalty ? ` + 占位违约金 ${strangerPenalty}` : '') +
      (ownerCompensation ? ` + 业主补偿 ${ownerCompensation}` : '') +
      ` - 优惠券 ${couponDiscount}` +
      (abnormalCompensation ? ` - 异常补偿 ${abnormalCompensation}` : '') +
      ` = 应付 ${payable} 元`,
  );

  return {
    occupiedHours: round2(occupiedHours),
    normalHours: round2(normalHours),
    overtimeHours: round2(overtimeHours),
    moveDelayMinutes,
    baseFee,
    rawBaseFee,
    overtimeFee,
    moveDelayPenalty,
    strangerPenalty,
    ownerCompensation,
    abnormalCompensation,
    couponDiscount,
    payable,
    explanation,
  };
}

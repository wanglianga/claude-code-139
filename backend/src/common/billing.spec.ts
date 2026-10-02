import { computeBilling } from './billing';

const base = {
  entry: new Date('2026-10-01T11:00:00Z'), // 19:00 北京
  exit: new Date('2026-10-02T01:00:00Z'),
  reservedStart: new Date('2026-10-01T11:00:00Z'),
  reservedEnd: new Date('2026-10-02T01:00:00Z'),
  hourlyRate: 6,
  nightlyCap: 30,
  overtimeMultiplier: 1.5,
  moveGraceMinutes: 15,
  noticeSentAt: null,
  ownerReturnedEarly: false,
};

describe('计费引擎', () => {
  it('正常夜停按封顶价', () => {
    const r = computeBilling({ ...base, responsibility: 'none', driverShare: 1 });
    // 14h * 6 = 84 → 封顶 30
    expect(r.baseFee).toBe(30);
    expect(r.overtimeFee).toBe(0);
    expect(r.payable).toBe(30);
  });

  it('超时按 1.5 倍计收且无业主补偿（车位无误）', () => {
    const r = computeBilling({
      ...base,
      exit: new Date('2026-10-02T03:00:00Z'),
      responsibility: 'none',
      driverShare: 1,
    });
    // 2h 超时 * 6 * 1.5 = 18
    expect(r.overtimeFee).toBe(18);
    expect(r.ownerCompensation).toBe(0);
    expect(r.payable).toBe(48);
  });

  it('车主确实停错：超时+挪车违约金+业主补偿', () => {
    const notice = new Date('2026-10-02T00:30:00Z'); // 宽限至 00:45，01:00 离场 → 15min
    const r = computeBilling({
      ...base,
      exit: new Date('2026-10-02T01:00:00Z'),
      noticeSentAt: notice,
      responsibility: 'driver',
      driverShare: 1,
    });
    // 15min * 6 * 2 = 3
    expect(r.moveDelayPenalty).toBe(3);
    expect(r.ownerCompensation).toBe(20);
    expect(r.payable).toBe(53);
  });

  it('业主提前回家：豁免费用并补偿车主，按实际停放计', () => {
    const r = computeBilling({
      ...base,
      entry: new Date('2026-10-01T11:00:00Z'),
      exit: new Date('2026-10-01T13:00:00Z'), // 只停了 2h
      reservedEnd: new Date('2026-10-02T01:00:00Z'),
      responsibility: 'owner',
      driverShare: 0,
      ownerReturnedEarly: true,
      evicted: true,
    });
    expect(r.baseFee).toBe(12);
    expect(r.abnormalCompensation).toBe(15);
    expect(r.payable).toBe(0);
  });

  it('优惠券抵扣不超过应收', () => {
    const r = computeBilling({
      ...base,
      responsibility: 'none',
      driverShare: 1,
      couponAmount: 50,
    });
    expect(r.couponDiscount).toBe(30);
    expect(r.payable).toBe(0);
  });

  it('混合责任 50%：超时费减半，豁免以异常补偿平账（仅超时无错停则无业主补偿）', () => {
    const r = computeBilling({
      ...base,
      exit: new Date('2026-10-02T03:00:00Z'),
      responsibility: 'none',
      driverShare: 0.5,
    });
    expect(r.overtimeFee).toBe(9);
    expect(r.abnormalCompensation).toBe(9);
    expect(r.ownerCompensation).toBe(0);
    expect(r.payable).toBe(30); // 30 + 9 - 9
  });

  it('混合责任 50% 且确实错停：业主补偿按比例计', () => {
    const r = computeBilling({
      ...base,
      exit: new Date('2026-10-02T03:00:00Z'),
      responsibility: 'none',
      driverShare: 0.5,
      wrongParked: true,
    });
    expect(r.ownerCompensation).toBe(10);
    expect(r.payable).toBe(40);
  });

  it('陌生占位违约金计入（独立惩罚单，无停车时段重叠）', () => {
    const r = computeBilling({
      ...base,
      // 占位车没有预约，其停放区间不与任何预约区间重叠
      reservedStart: new Date('2026-10-02T02:00:00Z'),
      reservedEnd: new Date('2026-10-02T03:00:00Z'),
      responsibility: 'none',
      driverShare: 0,
      strangerPenalty: true,
    });
    expect(r.baseFee).toBe(0);
    expect(r.strangerPenalty).toBe(50);
    expect(r.payable).toBe(50);
  });
});

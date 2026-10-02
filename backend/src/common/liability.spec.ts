import { determineLiability, LiabilityInput } from './liability';

const T = (s: string) => new Date(s);

const baseInput: LiabilityInput = {
  plate: '京A12345',
  reservedSpotCode: 'B2-A-018',
  actualSpotCode: 'B2-A-018',
  reservedStart: T('2026-10-01T11:00:00Z'),
  reservedEnd: T('2026-10-02T01:00:00Z'),
  entry: T('2026-10-01T11:05:00Z'),
  exit: T('2026-10-02T01:00:00Z'),
  vehicleType: 'ev',
  reservedSpotIsCharger: false,
  actualSpotIsCharger: false,
  anprEntry: { plate: '京A12345', confidence: 0.97, at: T('2026-10-01T11:05:00Z'), matchType: 'matched' },
  anprExit: { plate: '京A12345', confidence: 0.96, at: T('2026-10-02T01:00:00Z'), matchType: 'matched' },
  photos: [],
  patrols: [],
  ownerReturnedAt: null,
  platformDispatch: null,
  weakSignalRecorded: false,
  noticeSentAt: null,
  noticeDelivered: false,
};

describe('错停责任判定引擎', () => {
  it('无争议、准时离场 → 申诉成立（无责）', () => {
    const r = determineLiability({ ...baseInput });
    expect(r.responsibility).toBe('none');
    expect(r.status).toBe('upheld');
    expect(r.creditImpact).toBe(false);
  });

  it('仅超时、车位正确 → 驳回但非错停（责任 none，承担全额）', () => {
    const r = determineLiability({
      ...baseInput,
      exit: T('2026-10-02T02:00:00Z'),
    });
    expect(r.status).toBe('rejected');
    expect(r.driverShare).toBe(1);
    expect(r.overtimeMinutes).toBe(60);
  });

  it('业主提前回家 → 业主责任，申诉成立', () => {
    const r = determineLiability({
      ...baseInput,
      exit: T('2026-10-01T23:00:00Z'),
      ownerReturnedAt: T('2026-10-01T22:30:00Z'),
    });
    expect(r.responsibility).toBe('owner');
    expect(r.driverShare).toBe(0);
    expect(r.status).toBe('upheld');
  });

  it('巡查证明在场期间预约车位被陌生车占用、本人停在别处 → 陌生车责任', () => {
    const r = determineLiability({
      ...baseInput,
      actualSpotCode: 'B2-C-030',
      patrols: [
        { at: T('2026-10-01T11:20:00Z'), spotCode: 'B2-A-018', plate: '京X99999', note: '陌生车' },
      ],
    });
    expect(r.responsibility).toBe('stranger');
    expect(r.status).toBe('upheld');
  });

  it('停在别的车位且无第三方原因 → 车主责任，扣信用', () => {
    const r = determineLiability({
      ...baseInput,
      actualSpotCode: 'B2-B-026',
      actualSpotIsCharger: true,
      vehicleType: 'fuel',
      patrols: [
        { at: T('2026-10-01T11:20:00Z'), spotCode: 'B2-B-026', plate: '京A12345' },
      ],
    });
    expect(r.responsibility).toBe('driver');
    expect(r.status).toBe('rejected');
    expect(r.creditImpact).toBe(true);
    expect(r.creditDelta).toBeLessThan(0);
    expect(r.findings.some((f) => f.conclusion.includes('燃油'))).toBe(true);
  });

  it('平台改派导致停错 → 平台导航责任', () => {
    const r = determineLiability({
      ...baseInput,
      actualSpotCode: 'B2-C-030',
      platformDispatch: {
        fromSpot: 'B2-A-018',
        toSpot: 'B2-C-030',
        at: T('2026-10-01T11:10:00Z'),
        note: 'A 区故障改派',
      },
    });
    expect(r.responsibility).toBe('platform_navigation');
    expect(r.status).toBe('upheld');
  });

  it('识别失败+人工放行未引导 → 物业责任', () => {
    const r = determineLiability({
      ...baseInput,
      actualSpotCode: 'B2-C-030',
      anprEntry: { plate: null, confidence: 0.31, at: T('2026-10-01T11:05:00Z'), matchType: 'manual' },
    });
    expect(r.responsibility).toBe('property');
    expect(r.status).toBe('upheld');
  });

  it('信号差+通知未达+超时 → 部分成立，车主 50%', () => {
    const r = determineLiability({
      ...baseInput,
      exit: T('2026-10-02T02:00:00Z'),
      weakSignalRecorded: true,
      noticeSentAt: T('2026-10-02T01:05:00Z'),
      noticeDelivered: false,
    });
    expect(r.status).toBe('partial');
    expect(r.driverShare).toBe(0.5);
  });
});

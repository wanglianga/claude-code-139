import { buildSpotTimeline, TimelineIncident, TimelineOrder } from '../src/domain/timeline';

const nightStart = new Date('2026-10-01T18:00:00Z');
const nightEnd = new Date('2026-10-02T09:00:00Z');

function order(partial: Partial<TimelineOrder>): TimelineOrder {
  return {
    id: 1,
    code: 'R1',
    driverName: '陈车主',
    plate: '沪AD88899',
    status: 'completed',
    reservedStart: new Date('2026-10-01T19:00:00Z'),
    reservedEnd: new Date('2026-10-02T08:00:00Z'),
    gateEntryAt: null,
    parkingConfirmedAt: null,
    gateExitAt: null,
    ...partial,
  };
}

describe('buildSpotTimeline', () => {
  test('两个相邻预约完整覆盖整晚，时间轴各自归属于对应车主', () => {
    const orders = [
      order({
        id: 1,
        code: 'R1',
        driverName: '陈车主',
        gateEntryAt: new Date('2026-10-01T19:00:00Z'),
        parkingConfirmedAt: new Date('2026-10-01T19:05:00Z'),
        gateExitAt: new Date('2026-10-02T01:00:00Z'),
        reservedEnd: new Date('2026-10-02T01:00:00Z'),
      }),
      order({
        id: 2,
        code: 'R2',
        driverName: '赵访客',
        plate: '沪A12345',
        reservedStart: new Date('2026-10-02T01:00:00Z'),
        reservedEnd: new Date('2026-10-02T08:00:00Z'),
        gateEntryAt: new Date('2026-10-02T01:02:00Z'),
        parkingConfirmedAt: new Date('2026-10-02T01:05:00Z'),
        gateExitAt: new Date('2026-10-02T08:30:00Z'),
        settlement: { ruling: null, baseFee: 28, overtimeFee: 3.75, wrongParkFine: 0, abnormalCompensation: 0, payable: 31.75 },
      }),
    ];
    const segs = buildSpotTimeline(nightStart, nightEnd, orders, []);
    const used = segs.filter((s) => s.occupantKind === 'driver');
    expect(used.some((s) => s.occupant.includes('陈车主'))).toBe(true);
    expect(used.some((s) => s.occupant.includes('赵访客'))).toBe(true);
    // 赵访客超时段必须解释为超时且由其承担费用
    const over = segs.find((s) => s.note && s.note.includes('超时'));
    expect(over).toBeTruthy();
    expect(over!.liability).toContain('超时');
  });

  test('陌生车占用时段被单独标注：预约车主不计该段费用，陌生车主担责', () => {
    const orders = [
      order({
        id: 1,
        gateEntryAt: new Date('2026-10-01T19:00:00Z'),
        parkingConfirmedAt: new Date('2026-10-01T19:40:00Z'), // 被占用 40 分钟
        gateExitAt: new Date('2026-10-02T08:00:00Z'),
      }),
    ];
    const incidents: TimelineIncident[] = [
      {
        id: 9,
        type: 'stranger_occupy',
        status: 'resolved',
        plate: '沪X00000',
        createdAt: new Date('2026-10-01T19:00:00Z'),
        resolvedAt: new Date('2026-10-01T19:40:00Z'),
        resolution: '物业到场劝离',
        reservationId: 1,
      },
    ];
    const segs = buildSpotTimeline(nightStart, nightEnd, orders, incidents);
    const strangerSeg = segs.find((s) => s.occupantKind === 'stranger');
    expect(strangerSeg).toBeTruthy();
    expect(strangerSeg!.plate).toBe('沪X00000');
    expect(strangerSeg!.payer).toContain('平台兜底');
    expect(strangerSeg!.liability).toContain('陌生车主');
  });

  test('业主临时回家后，该时段标注为业主自用且业主担责', () => {
    const orders = [
      order({
        id: 1,
        gateEntryAt: new Date('2026-10-01T19:00:00Z'),
        parkingConfirmedAt: new Date('2026-10-01T19:00:00Z'),
        gateExitAt: new Date('2026-10-01T22:00:00Z'),
        reservedEnd: new Date('2026-10-02T08:00:00Z'),
      }),
    ];
    const incidents: TimelineIncident[] = [
      {
        id: 3,
        type: 'owner_return',
        status: 'resolved',
        plate: '沪AD88899',
        createdAt: new Date('2026-10-01T22:00:00Z'),
        resolvedAt: new Date('2026-10-02T08:00:00Z'),
        resolution: '车主已挪车，业主自用',
        reservationId: 1,
      },
    ];
    const segs = buildSpotTimeline(nightStart, nightEnd, orders, incidents);
    const ownerSeg = segs.find((s) => s.occupantKind === 'owner');
    expect(ownerSeg).toBeTruthy();
    expect(ownerSeg!.liability).toContain('业主');
  });
});

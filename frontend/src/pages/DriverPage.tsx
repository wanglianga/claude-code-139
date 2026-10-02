import React, { useState } from 'react';
import { api } from '../App';
import { Card, Findings, KV, Money, Tag, toISO, usePoll, useToast } from '../components/ui';
import { fmtClock, fmtDT, minToClock } from '../api';

export function DriverPage({ user }: { user: any }) {
  const toast = useToast();
  const { data: spots, reload } = usePoll(() => api.get('/parking/spots'), []);
  const { data: reservations, reload: reloadR } = usePoll(() =>
    api.get('/parking/reservations?scope=mine'), [],
  );
  const { data: coupons, reload: reloadC } = usePoll(() => api.get('/parking/coupons'), []);

  const [rf, setRf] = useState<any>({
    slotId: '', plate: user.plates?.split(',')[0] ?? '', start: '', end: '',
    isVisitor: false, vehicleType: 'ev', couponCode: '',
  });
  const [appealF, setAppealF] = useState<any>({
    reservationId: '', plate: user.plates?.split(',')[0] ?? '', reason: '', spotCode: '',
  });

  const reserve = async () => {
    try {
      await api.post('/parking/reservations', {
        slotId: rf.slotId, plate: rf.plate, startTime: toISO(rf.start), endTime: toISO(rf.end),
        isVisitor: rf.isVisitor, vehicleType: rf.vehicleType, couponCode: rf.couponCode || undefined,
      });
      toast('预约成功', 'ok');
      reloadR(); reloadC();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const entry = async (r: any) => {
    try {
      const res = await api.post('/parking/gate/entry', {
        reservationId: r.id, recognizedPlate: r.plate, confidence: 0.97,
      });
      if (!res.barrierOpened) toast(`道闸未抬起：${res.hint ?? res.matchType}`, 'err');
      else toast(`抬杆入场，导航：${res.navigation}`, 'ok');
      reloadR();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const exitGate = async (r: any, useCoupon: boolean) => {
    const at = new Date().toISOString();
    try {
      const res = await api.post('/parking/gate/exit', {
        reservationId: r.id, recognizedPlate: r.plate, confidence: 0.96,
        couponCode: useCoupon ? (coupons ?? []).find((c: any) => !c.used)?.code : undefined,
      });
      if (!res.barrierOpened) { toast('离场识别失败，请联系物业人工放行', 'err'); return; }
      toast(`已离场结算，应付 ¥${res.billing.payable}`, 'ok');
      reloadR(); reloadC();
      void at;
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const submitAppeal = async () => {
    try {
      const body: any = {
        reservationId: appealF.reservationId || undefined,
        plate: appealF.plate, reason: appealF.reason,
      };
      if (appealF.spotCode) {
        body.evidences = [{
          kind: 'site_photo', content: '车主提交现场照片',
          spotCode: appealF.spotCode, plate: appealF.plate,
        }];
      }
      const r = await api.post('/appeals', body);
      toast(`申诉已受理，系统初判：${r.status}（${r.findings?.reason ?? ''}）`, 'ok');
      setAppealF({ ...appealF, reason: '', spotCode: '' });
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const { data: appeals, reload: reloadA } = usePoll(async () => {
    const all = await api.get('/appeals');
    return all.filter((a: any) => a.appellant?.username === user.username);
  }, []);

  return (
    <div>
      <div className="grid cols2">
        <Card title="① 浏览并预约共享车位">
          <label>选择共享时段（车位 · 日期 · 窗口 UTC）</label>
          <select value={rf.slotId} onChange={(e) => setRf({ ...rf, slotId: e.target.value })}>
            <option value="">请选择</option>
            {(spots ?? []).flatMap((s: any) =>
              s.slots.map((sl: any) => (
                <option key={sl.id} value={sl.id}>
                  {s.community.name} · {s.code} · {sl.date} {minToClock(sl.startMinute)}-
                  {minToClock(sl.endMinute % 1440)}{sl.endMinute >= 1440 ? '次日' : ''}
                  {s.isChargerSpot ? ' ·充电位' : ''}{!s.allowVisitor ? ' ·禁访客' : ''} ·¥{s.hourlyRate}/h
                </option>
              )),
            )}
          </select>
          <div className="row">
            <div><label>车牌号</label><input value={rf.plate} onChange={(e) => setRf({ ...rf, plate: e.target.value })} /></div>
            <div><label>车型</label>
              <select value={rf.vehicleType} onChange={(e) => setRf({ ...rf, vehicleType: e.target.value })}>
                <option value="ev">新能源</option>
                <option value="fuel">燃油车</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div><label>开始(UTC)</label><input type="datetime-local" value={rf.start} onChange={(e) => setRf({ ...rf, start: e.target.value })} /></div>
            <div><label>结束(UTC)</label><input type="datetime-local" value={rf.end} onChange={(e) => setRf({ ...rf, end: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="checkrow" style={{ flex: 'none' }}><input type="checkbox" checked={rf.isVisitor} onChange={(e) => setRf({ ...rf, isVisitor: e.target.checked })} /><label>访客车辆</label></div>
            <div><label>优惠券</label>
              <select value={rf.couponCode} onChange={(e) => setRf({ ...rf, couponCode: e.target.value })}>
                <option value="">不使用</option>
                {(coupons ?? []).filter((c: any) => !c.used).map((c: any) => (
                  <option key={c.id} value={c.code}>{c.code}（¥{c.amount}）</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn primary" onClick={reserve}>提交预约</button>
          <div className="muted" style={{ marginTop: 8 }}>
            月租车优先车位，非月租车仅可在开始前 24 小时内下单；系统会校验同时段占用冲突。
          </div>
        </Card>

        <Card title="② 错停/超时申诉">
          <label>关联预约</label>
          <select value={appealF.reservationId} onChange={(e) => setAppealF({ ...appealF, reservationId: e.target.value })}>
            <option value="">选择预约（可选）</option>
            {(reservations ?? []).map((r: any) => (
              <option key={r.id} value={r.id}>{r.plate} · {r.spot.code} · {fmtDT(r.startTime)}</option>
            ))}
          </select>
          <label>车牌</label><input value={appealF.plate} onChange={(e) => setAppealF({ ...appealF, plate: e.target.value })} />
          <label>申诉理由（导航偏差/道闸识别/被人占位/信号差…）</label>
          <textarea value={appealF.reason} onChange={(e) => setAppealF({ ...appealF, reason: e.target.value })} />
          <label>现场照片实际车位编号（可选）</label>
          <input value={appealF.spotCode} onChange={(e) => setAppealF({ ...appealF, spotCode: e.target.value })} placeholder="如 B2-D-009" />
          <button className="btn primary" style={{ marginTop: 10 }} onClick={submitAppeal}>提交申诉</button>
          <div className="muted" style={{ marginTop: 8 }}>
            平台将综合车牌识别、预约记录、现场照片、道闸日志、业主回家时间、物业巡查六类证据自动核查，再由物业复核裁决。
          </div>
        </Card>
      </div>

      <div className="section-title">我的预约 / 停车服务（{reservations?.length ?? 0}）</div>
      <div className="grid cols2">
        {(reservations ?? []).map((r: any) => (
          <Card key={r.id} title={`${r.plate} · ${r.spot.code}`} extra={<Tag v={r.status} />}>
            <KV k="小区" v={r.spot.community.name} />
            <KV k="预约时段" v={`${fmtDT(r.startTime)} → ${fmtDT(r.endTime)}`} />
            <KV k="预估费用" v={<Money n={r.estimatedFee} />} />
            {r.dispatchNote && <KV k="夜间调度" v={<span className="small">{r.dispatchNote}</span>} />}
            {r.session ? (
              <>
                <KV k="入场" v={`${fmtDT(r.session.entryTime)}（${r.session.entryMatchType}）`} />
                <KV k="离场" v={r.session.exitTime ? `${fmtDT(r.session.exitTime)}（${r.session.exitMatchType}）` : '在场中'} />
                {r.session.navigationRoute && <KV k="导航引导" v={<span className="small">{r.session.navigationRoute}</span>} />}
                {r.session.billing && (
                  <div style={{ marginTop: 8 }}>
                    <KV k="基础费" v={<Money n={r.session.billing.baseFee} />} />
                    <KV k="超时费" v={<Money n={r.session.billing.overtimeFee} />} />
                    <KV k="挪车违约金" v={<Money n={r.session.billing.moveDelayPenalty} />} />
                    <KV k="优惠券" v={<Money n={r.session.billing.couponDiscount} />} />
                    <KV k="异常补偿" v={<Money n={r.session.billing.abnormalCompensation} />} />
                    <KV k="实付" v={<Money n={r.session.billing.payable} />} />
                    <pre className="explain">{(r.session.billing.explanation ?? []).join('\n')}</pre>
                  </div>
                )}
                {!r.session.exitTime && r.status === 'booked' && (
                  <button className="btn ok" style={{ marginTop: 8 }} onClick={() => exitGate(r, false)}>模拟离场结算</button>
                )}
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                {r.status === 'booked' && <button className="btn primary" onClick={() => entry(r)}>模拟车牌识别入场</button>}
                {r.status === 'cancelled' && <span className="muted">已取消</span>}
                {r.status === 'dispatched' && <span className="muted">本单已调度改派，请在新预约单上入场</span>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="section-title">我的申诉</div>
      <div className="grid cols2">
        {(appeals ?? []).map((a: any) => (
          <Card key={a.id} title={`申诉 · ${a.plate} · ${a.spot.code}`} extra={<Tag v={a.status} />}>
            <KV k="提交时间" v={fmtDT(a.createdAt)} />
            <KV k="诉求" v={<span className="small">{a.reason}</span>} />
            <KV k="责任判定" v={a.responsibility} />
            <KV k="车主承担比例" v={`${Math.round(a.driverShare * 100)}%`} />
            <KV k="超时费/挪车违约" v={<><Money n={a.overtimeFee} /> / <Money n={a.moveDelayPenalty} /></>} />
            <KV k="业主补偿/退款" v={<><Money n={a.ownerCompensation} /> / <Money n={a.refundAmount} /></>} />
            <KV k="信用影响" v={a.creditImpact ? <span className="bad-text">{a.creditDelta} 分</span> : '不影响'} />
            <KV k="裁决人备注" v={a.adjudicatorNote ?? '待物业复核'} />
            <h3>证据链与推理</h3>
            <Findings data={a.findings} />
          </Card>
        ))}
        {!appeals?.length && <Card><span className="muted">暂无申诉</span></Card>}
      </div>
      <span style={{ display: 'none' }}>{fmtClock(new Date().toISOString())}</span>
    </div>
  );
}

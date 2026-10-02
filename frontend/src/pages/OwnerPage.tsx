import React, { useState } from 'react';
import { api } from '../App';
import { Card, KV, Money, Tag, toISO, usePoll, useToast } from '../components/ui';
import { fmtDT } from '../api';
import { minToClock } from '../api';

export function OwnerPage({ user }: { user: any }) {
  const toast = useToast();
  const { data: spots, reload } = usePoll(() => api.get('/parking/my-spots'), []);
  const { data: communities } = usePoll(() => api.get('/parking/communities'), []);
  const { data: reservations, reload: reloadR } = usePoll(() =>
    api.get('/parking/reservations?scope=owner'), [],
  );

  const [f, setF] = useState<any>({
    code: '', zone: '地下二层', deedNo: '', communityId: '', nearCharger: false,
    isChargerSpot: false, allowVisitor: true, monthlyPriority: 'none', navigationHint: '',
  });
  const [slotF, setSlotF] = useState<any>({ spotId: '', date: '', start: '19:00', end: '09:00', guaranteed: true });
  const [returnF, setReturnF] = useState<any>({ slotId: '', at: '' });

  const submitSpot = async () => {
    try {
      await api.post('/parking/spots', f);
      toast('车位已提交，等待物业审核', 'ok');
      reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const submitSlot = async () => {
    try {
      const toMin = (s: string) => {
        const [h, m] = s.split(':').map(Number);
        return h * 60 + m;
      };
      let end = toMin(slotF.end);
      if (end <= toMin(slotF.start)) end += 1440;
      await api.post('/parking/slots', {
        spotId: slotF.spotId, date: slotF.date,
        startMinute: toMin(slotF.start), endMinute: end, guaranteed: slotF.guaranteed,
      });
      toast('共享时段已发布', 'ok');
      reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const ownerReturn = async () => {
    try {
      const r = await api.post('/parking/owner-return', {
        slotId: returnF.slotId, at: toISO(returnF.at),
      });
      toast(
        `已登记回家：${r.notice ? '挪车通知已发出；' : ''}` +
          (r.dispatched ? `已自动调度改派至 ${r.dispatched.spot.code}` : '无替代车位，订单已清退待结算'),
        'ok',
      );
      reload(); reloadR();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  const allSlots = (spots ?? []).flatMap((s: any) => s.slots.map((sl: any) => ({ ...sl, spot: s })));

  return (
    <div>
      <div className="grid cols2">
        <Card title="① 发布闲置车位（产权登记）">
          <div className="row">
            <div><label>小区</label>
              <select value={f.communityId} onChange={(e) => setF({ ...f, communityId: e.target.value })}>
                <option value="">选择小区</option>
                {(communities ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label>车位编号</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="B2-A-018" /></div>
          </div>
          <div className="row">
            <div><label>区域</label><input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></div>
            <div><label>产权证号</label><input value={f.deedNo} onChange={(e) => setF({ ...f, deedNo: e.target.value })} placeholder="京(2024)朝字第0000号" /></div>
          </div>
          <div className="checkrow"><input type="checkbox" checked={f.nearCharger} onChange={(e) => setF({ ...f, nearCharger: e.target.checked })} /><label>靠近充电桩</label></div>
          <div className="checkrow"><input type="checkbox" checked={f.isChargerSpot} onChange={(e) => setF({ ...f, isChargerSpot: e.target.checked })} /><label>本身是充电车位</label></div>
          <div className="checkrow"><input type="checkbox" checked={f.allowVisitor} onChange={(e) => setF({ ...f, allowVisitor: e.target.checked })} /><label>允许访客车辆</label></div>
          <label>月租车优先规则</label>
          <select value={f.monthlyPriority} onChange={(e) => setF({ ...f, monthlyPriority: e.target.value })}>
            <option value="none">不限制</option>
            <option value="monthly_first">月租车优先（非月租仅可提前 24h 内预约）</option>
          </select>
          <label>导航引导描述</label>
          <input value={f.navigationHint} onChange={(e) => setF({ ...f, navigationHint: e.target.value })} placeholder="A 区直行到底左转，靠立柱 18 号" />
          <div style={{ marginTop: 10 }}><button className="btn primary" onClick={submitSpot}>提交物业审核</button></div>
        </Card>

        <Card title="② 发布共享时段">
          <label>已审核通过的车位</label>
          <select value={slotF.spotId} onChange={(e) => setSlotF({ ...slotF, spotId: e.target.value })}>
            <option value="">选择车位</option>
            {(spots ?? []).filter((s: any) => s.approvalStatus === 'approved').map((s: any) => (
              <option key={s.id} value={s.id}>{s.code}（{s.zone}）</option>
            ))}
          </select>
          <div className="row">
            <div><label>共享日期</label><input type="date" value={slotF.date} onChange={(e) => setSlotF({ ...slotF, date: e.target.value })} /></div>
            <div><label>开始时间(UTC)</label><input type="time" value={slotF.start} onChange={(e) => setSlotF({ ...slotF, start: e.target.value })} /></div>
            <div><label>结束时间(UTC)</label><input type="time" value={slotF.end} onChange={(e) => setSlotF({ ...slotF, end: e.target.value })} /></div>
          </div>
          <div className="checkrow"><input type="checkbox" checked={slotF.guaranteed} onChange={(e) => setSlotF({ ...slotF, guaranteed: e.target.checked })} /><label>承诺此时段不回家（提前回家将承担违约补偿）</label></div>
          <button className="btn primary" onClick={submitSlot}>发布时段</button>
        </Card>
      </div>

      <Card title="③ 临时回家（触发挪车通知 + 夜间自动调度）">
        <div className="row">
          <div style={{ flex: 2 }}><label>选择共享时段</label>
            <select value={returnF.slotId} onChange={(e) => setReturnF({ ...returnF, slotId: e.target.value })}>
              <option value="">选择时段</option>
              {allSlots.map((sl: any) => (
                <option key={sl.id} value={sl.id}>{sl.spot.code} · {sl.date} {minToClock(sl.startMinute)}-{minToClock(sl.endMinute % 1440)}{sl.endMinute >= 1440 ? '+' : ''}（次日）</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}><label>实际回家时间(UTC)</label>
            <input type="datetime-local" value={returnF.at} onChange={(e) => setReturnF({ ...returnF, at: e.target.value })} />
          </div>
        </div>
        <button className="btn danger" style={{ marginTop: 10 }} onClick={ownerReturn}>登记回家并启动调度</button>
      </Card>

      <div className="section-title">我的车位</div>
      <div className="grid cols2">
        {(spots ?? []).map((s: any) => (
          <Card key={s.id} title={`车位 ${s.code}`} extra={<Tag v={s.approvalStatus} />}>
            <KV k="区域" v={s.zone} />
            <KV k="产权证号" v={s.deedNo} />
            <KV k="靠近充电桩" v={s.nearCharger ? '是' : '否'} />
            <KV k="充电车位" v={s.isChargerSpot ? '是' : '否'} />
            <KV k="允许访客" v={s.allowVisitor ? '是' : '否'} />
            <KV k="月租优先" v={s.monthlyPriority === 'monthly_first' ? '月租车优先' : '不限制'} />
            <KV k="审核备注" v={s.reviewNote ?? '—'} />
            <h3>已发布共享时段</h3>
            <table>
              <thead><tr><th>日期</th><th>窗口(UTC)</th><th>保证</th><th>回家时间</th></tr></thead>
              <tbody>
                {s.slots.map((sl: any) => (
                  <tr key={sl.id}>
                    <td>{sl.date}</td>
                    <td>{minToClock(sl.startMinute)}–{minToClock(sl.endMinute % 1440)}{sl.endMinute >= 1440 ? ' 次日' : ''}</td>
                    <td>{sl.guaranteed ? '是' : '否'}</td>
                    <td>{sl.ownerReturnedAt ? fmtDT(sl.ownerReturnedAt) : '—'}</td>
                  </tr>
                ))}
                {!s.slots.length && <tr><td colSpan={4} className="muted">暂无</td></tr>}
              </tbody>
            </table>
          </Card>
        ))}
        {!spots?.length && <Card><span className="muted">还没有发布车位</span></Card>}
      </div>

      <div className="section-title">我的车位上的预约（{reservations?.length ?? 0}）</div>
      <Card>
        <table>
          <thead><tr><th>车牌</th><th>车位</th><th>时段(UTC)</th><th>状态</th><th>预估</th><th>入场/离场</th><th>调度说明</th></tr></thead>
          <tbody>
            {(reservations ?? []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.plate}</td>
                <td>{r.spot.code}</td>
                <td>{fmtDT(r.startTime)}<br />{fmtDT(r.endTime)}</td>
                <td><Tag v={r.status} /></td>
                <td><Money n={r.estimatedFee} /></td>
                <td>{r.session ? `${r.session.entryMatchType} / ${r.session.exitMatchType ?? '在场'}` : '未入场'}</td>
                <td className="small muted">{r.dispatchNote ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

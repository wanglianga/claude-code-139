import React, { useState } from 'react';
import { api } from '../App';
import {
  Card, Findings, KV, Money, Tag, incLabel, respLabel, toISO, usePoll, useToast,
} from '../components/ui';
import { fmtClock, fmtDT, minToClock } from '../api';

const TABS = [
  ['review', '车位审核'],
  ['gate', '道闸台'],
  ['incidents', '夜间异常与调度'],
  ['appeals', '申诉裁决'],
  ['settlements', '分账清算'],
  ['trace', '追溯中心'],
];

export function PropertyPage({ user }: { user: any }) {
  const [tab, setTab] = useState('review');
  return (
    <div>
      <div className="tabs" style={{ marginBottom: 14 }}>
        {TABS.map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'review' && <ReviewTab />}
      {tab === 'gate' && <GateTab />}
      {tab === 'incidents' && <IncidentsTab />}
      {tab === 'appeals' && <AppealsTab />}
      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'trace' && <TraceTab />}
      <span style={{ display: 'none' }}>{user.id}</span>
    </div>
  );
}

function ReviewTab() {
  const toast = useToast();
  const { data: pending, reload } = usePoll(() => api.get('/parking/review/pending'), []);
  const review = async (id: string, approve: boolean) => {
    try {
      await api.post(`/parking/spots/${id}/review`, {
        approve, note: approve ? '产权与现场一致，审核通过' : '资料存疑，驳回补充',
      });
      toast(approve ? '已通过' : '已驳回', 'ok');
      reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  return (
    <Card title="车位发布审核（产权 / 充电 / 访客 / 月租优先规则登记）">
      <table>
        <thead><tr><th>车位</th><th>产权证号</th><th>业主</th><th>充电相关</th><th>访客</th><th>月租优先</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {(pending ?? []).map((s: any) => (
            <tr key={s.id}>
              <td><b>{s.code}</b><br /><span className="muted small">{s.zone}</span></td>
              <td className="small">{s.deedNo}</td>
              <td>{s.owner.displayName}</td>
              <td className="small">
                {s.isChargerSpot ? '⚡充电位' : s.nearCharger ? '靠近充电桩' : '普通'}
              </td>
              <td>{s.allowVisitor ? '允许' : '不允许'}</td>
              <td>{s.monthlyPriority === 'monthly_first' ? '月租优先' : '不限制'}</td>
              <td><Tag v={s.approvalStatus} /></td>
              <td>
                <button className="btn ok sm" onClick={() => review(s.id, true)}>通过</button>{' '}
                <button className="btn danger sm" onClick={() => review(s.id, false)}>驳回</button>
              </td>
            </tr>
          ))}
          {!pending?.length && <tr><td colSpan={8} className="muted">暂无待审车位</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

function GateTab() {
  const toast = useToast();
  const { data: reservations, reload } = usePoll(() => api.get('/parking/reservations'), []);
  const { data: events, reload: reloadE } = usePoll(() => api.get('/parking/gate/events'), []);
  const [f, setF] = useState<any>({ reservationId: '', plate: '', confidence: 0.4, at: '', manual: false, verifiedPlate: '', note: '' });

  const call = async (dir: 'in' | 'out') => {
    try {
      const body: any = { at: toISO(f.at) || undefined };
      if (f.reservationId) body.reservationId = f.reservationId;
      if (f.manual) {
        body.manual = true;
        body.verifiedPlate = f.verifiedPlate || f.plate;
        body.note = f.note || '物业人工放行';
      } else {
        body.recognizedPlate = f.plate;
        body.confidence = Number(f.confidence);
      }
      const r = await api.post(`/parking/gate/${dir}`, body);
      if (r.barrierOpened) toast(`抬杆放行 ✓ ${r.navigation ? '导航：' + r.navigation : ''}`, 'ok');
      else toast(`未抬杆：${r.hint ?? r.matchType}（异常单 ${r.incidentId ?? '无'}）`, 'err');
      reload(); reloadE();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div className="grid cols2">
      <Card title="道闸操作台（车牌识别 / 识别失败 / 人工放行）">
        <label>关联预约</label>
        <select value={f.reservationId} onChange={(e) => setF({ ...f, reservationId: e.target.value })}>
          <option value="">按车牌自动匹配</option>
          {(reservations ?? []).map((r: any) => (
            <option key={r.id} value={r.id}>{r.plate} · {r.spot.code} · {r.status}</option>
          ))}
        </select>
        <div className="row">
          <div><label>识别车牌号（脏号/留空=失败）</label><input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></div>
          <div><label>置信度</label><input type="number" step="0.01" min="0" max="1" value={f.confidence} onChange={(e) => setF({ ...f, confidence: e.target.value })} /></div>
        </div>
        <label>事件时间(UTC)</label>
        <input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
        <div className="checkrow"><input type="checkbox" checked={f.manual} onChange={(e) => setF({ ...f, manual: e.target.checked })} /><label>物业人工放行</label></div>
        {f.manual && (
          <div className="row">
            <div><label>核验车牌</label><input value={f.verifiedPlate} onChange={(e) => setF({ ...f, verifiedPlate: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label>备注</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => call('in')}>入场识别/放行</button>{' '}
          <button className="btn ok" onClick={() => call('out')}>离场识别/结算</button>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          识别失败会自动生成异常单并不抬杆；人工放行将记录操作员与核验车牌，作为申诉证据。
        </div>
      </Card>
      <Card title="道闸日志（最近 12 条）">
        <table>
          <thead><tr><th>时间</th><th>方向</th><th>识别</th><th>类型</th><th>抬杆</th></tr></thead>
          <tbody>
            {(events ?? []).slice(0, 12).map((g: any) => (
              <tr key={g.id}>
                <td className="small">{fmtDT(g.occurredAt)}</td>
                <td>{g.direction === 'in' ? '入场' : '离场'}</td>
                <td>{g.recognizedPlate ?? <span className="bad-text">失败/无</span>}</td>
                <td><Tag v={g.matchType} /></td>
                <td>{g.barrierOpened ? '✓' : <span className="bad-text">✗</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function IncidentsTab() {
  const toast = useToast();
  const { data: incidents, reload } = usePoll(() => api.get('/parking/incidents'), [], 8000);
  const { data: reservations } = usePoll(() => api.get('/parking/reservations'), []);
  const { data: spots } = usePoll(() => api.get('/parking/spots'), []);
  const [f, setF] = useState<any>({ type: 'visitor_overtime', spotId: '', reservationId: '', involvedPlate: '', description: '', at: '' });
  const [patrol, setPatrol] = useState<any>({ spotId: '', plate: '', note: '', at: '' });

  const report = async () => {
    try {
      await api.post('/parking/incidents', {
        type: f.type, spotId: f.spotId, reservationId: f.reservationId || undefined,
        involvedPlate: f.involvedPlate || undefined, description: f.description, at: toISO(f.at) || undefined,
      });
      toast('异常已登记', 'ok'); reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const patrolSubmit = async () => {
    try {
      const r = await api.post('/parking/patrol', {
        spotId: patrol.spotId, plate: patrol.plate || undefined, note: patrol.note, at: toISO(patrol.at) || undefined,
      });
      toast(r.autoIncident ? '巡查已记录，并自动生成陌生占位异常单' : '巡查已记录', 'ok');
      reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const notice = async (id: string, plate: string) => {
    await api.post(`/parking/incidents/${id}/move-notice`, { plate });
    toast('挪车通知已发送（宽限 15 分钟）', 'ok'); reload();
  };
  const dispatch = async (id: string) => {
    const inc = incidents.find((x: any) => x.id === id);
    if (!inc?.reservation?.id) { toast('该异常无关联预约，无法改派', 'err'); return; }
    try {
      const r = await api.post('/parking/dispatch', { reservationId: inc.reservation.id, note: '物业夜间人工调度改派' });
      toast(r.evicted ? '无可用替代车位，订单已清退' : `已改派至 ${r.spot.code}`, 'ok');
      reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const charge = async (id: string) => {
    try {
      const o = await api.post(`/parking/incidents/${id}/charge-stranger`, {});
      toast(`已生成陌生占位追缴单：¥${o.payable}`, 'ok'); reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const close = async (id: string) => {
    await api.post(`/parking/incidents/${id}/resolve`, { note: '现场处置完成' });
    toast('已闭环', 'ok'); reload();
  };

  return (
    <div>
      <div className="grid cols2">
        <Card title="登记夜间异常">
          <div className="row">
            <div style={{ flex: 1.3 }}><label>异常类型</label>
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {Object.entries({
                  owner_return: '业主临时回家', visitor_overtime: '访客车辆超时',
                  stranger_occupation: '陌生车辆占位', recognition_failed: '道闸识别失败',
                  weak_signal: '地下车库信号差', fuel_on_charger: '充电位被燃油车占用',
                  manual_release: '物业人工放行',
                }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>时间(UTC)</label><input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></div>
          </div>
          <div className="row">
            <div><label>车位</label>
              <select value={f.spotId} onChange={(e) => setF({ ...f, spotId: e.target.value })}>
                <option value="">选择</option>
                {(spots ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </select>
            </div>
            <div><label>关联预约</label>
              <select value={f.reservationId} onChange={(e) => setF({ ...f, reservationId: e.target.value })}>
                <option value="">自动匹配</option>
                {(reservations ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.plate} {r.spot.code}</option>)}
              </select>
            </div>
            <div><label>涉事车牌</label><input value={f.involvedPlate} onChange={(e) => setF({ ...f, involvedPlate: e.target.value })} /></div>
          </div>
          <label>描述</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <button className="btn primary" style={{ marginTop: 8 }} onClick={report}>登记异常</button>
        </Card>
        <Card title="物业巡查（发现错停/占位自动开单）">
          <div className="row">
            <div><label>车位</label>
              <select value={patrol.spotId} onChange={(e) => setPatrol({ ...patrol, spotId: e.target.value })}>
                <option value="">选择</option>
                {(spots ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </select>
            </div>
            <div><label>现场车牌（空=无车）</label><input value={patrol.plate} onChange={(e) => setPatrol({ ...patrol, plate: e.target.value })} /></div>
            <div><label>时间(UTC)</label><input type="datetime-local" value={patrol.at} onChange={(e) => setPatrol({ ...patrol, at: e.target.value })} /></div>
          </div>
          <label>巡查备注</label><input value={patrol.note} onChange={(e) => setPatrol({ ...patrol, note: e.target.value })} />
          <button className="btn primary" style={{ marginTop: 8 }} onClick={patrolSubmit}>提交巡查</button>
        </Card>
      </div>

      <Card title={`异常事件列表（${incidents?.length ?? 0}）`}>
        <table>
          <thead><tr><th>时间</th><th>类型</th><th>车位</th><th>车牌</th><th>说明</th><th>挪车通知</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {(incidents ?? []).map((i: any) => (
              <tr key={i.id}>
                <td className="small">{fmtDT(i.occurredAt)}</td>
                <td><Tag v={i.type} map={{}} /><div className="small muted">{incLabel(i.type)}</div></td>
                <td>{i.spot?.code}</td>
                <td>{i.involvedPlate ?? i.reservation?.plate ?? '—'}</td>
                <td className="small" style={{ maxWidth: 260 }}>{i.description}</td>
                <td className="small">
                  {(i.moveNotices ?? []).map((n: any) => (
                    <div key={n.id}>{fmtClock(n.sentAt)} {n.status}（{n.channel}）{n.movedAt ? ` 移走@${fmtClock(n.movedAt)}` : ''}</div>
                  ))}
                </td>
                <td><Tag v={i.status} /></td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => notice(i.id, i.involvedPlate ?? i.reservation?.plate ?? '')}>发挪车通知</button>{' '}
                  <button className="btn sm" onClick={() => dispatch(i.id)}>调度改派</button>{' '}
                  {i.type === 'stranger_occupation' && <button className="btn sm danger" onClick={() => charge(i.id)}>追缴¥50</button>}{' '}
                  <button className="btn sm ok" onClick={() => close(i.id)}>闭环</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AppealsTab() {
  const toast = useToast();
  const { data: appeals, reload } = usePoll(() => api.get('/appeals'), [], 8000);
  const [note, setNote] = useState<any>({});
  const [over, setOver] = useState<any>({});

  const adjudicate = async (id: string) => {
    const body: any = { note: note[id] || '物业复核确认' };
    if (over[id]?.responsibility) body.overrideResponsibility = over[id].responsibility;
    if (over[id]?.driverShare !== undefined && over[id]?.driverShare !== '')
      body.overrideDriverShare = Number(over[id].driverShare);
    try {
      await api.post(`/appeals/${id}/adjudicate`, body);
      toast('裁决完成，费用与信用已处置', 'ok'); reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };
  const runEngine = async (id: string) => {
    await api.post(`/appeals/${id}/run-engine`, {});
    toast('已重新运行责任引擎', 'ok'); reload();
  };

  return (
    <div className="grid cols2">
      {(appeals ?? []).map((a: any) => (
        <Card key={a.id} title={`${a.plate} 申诉 ${a.spot.code}`} extra={<Tag v={a.status} />}>
          <KV k="申诉人" v={a.appellant.displayName} />
          <KV k="诉求" v={<span className="small">{a.reason}</span>} />
          <KV k="引擎/裁决责任" v={<Tag v={a.responsibility} />} />
          <KV k="车主承担" v={`${Math.round(a.driverShare * 100)}%`} />
          <KV k="超时/挪车/业主补偿" v={<>{<Money n={a.overtimeFee} />} / {<Money n={a.moveDelayPenalty} />} / {<Money n={a.ownerCompensation} />}</>} />
          <KV k="退款" v={<Money n={a.refundAmount} />} />
          <KV k="信用" v={a.creditImpact ? <span className="bad-text">{a.creditDelta}</span> : '不影响'} />
          <Findings data={a.findings} />
          <h3>证据材料（{a.evidences?.length ?? 0}）</h3>
          <table>
            <tbody>
              {(a.evidences ?? []).map((e: any) => (
                <tr key={e.id}>
                  <td className="small"><Tag v={e.kind} map={{}} />{e.spotCode ? ` @${e.spotCode}` : ''}{e.plate ? ` ${e.plate}` : ''}</td>
                  <td className="small muted">{e.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>人工改判（可选，留痕）</h3>
          <div className="row">
            <div><label>责任</label>
              <select onChange={(e) => setOver({ ...over, [a.id]: { ...over[a.id], responsibility: e.target.value } })}
                value={over[a.id]?.responsibility ?? ''}>
                <option value="">按引擎建议</option>
                <option value="driver">车主</option><option value="owner">业主</option>
                <option value="property">物业</option><option value="platform_navigation">平台</option>
                <option value="stranger">陌生车</option><option value="none">无责</option>
              </select>
            </div>
            <div><label>车主比例 0-1</label>
              <input type="number" step="0.1" min="0" max="1"
                value={over[a.id]?.driverShare ?? ''}
                onChange={(e) => setOver({ ...over, [a.id]: { ...over[a.id], driverShare: e.target.value } })} />
            </div>
          </div>
          <label>裁决备注</label>
          <input value={note[a.id] ?? ''} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => runEngine(a.id)}>重跑引擎</button>{' '}
            <button className="btn primary sm" onClick={() => adjudicate(a.id)}>确认裁决并清算费用</button>
          </div>
        </Card>
      ))}
      {!appeals?.length && <Card><span className="muted">暂无申诉</span></Card>}
    </div>
  );
}

function SettlementsTab() {
  const toast = useToast();
  const { data: communities } = usePoll(() => api.get('/parking/communities'), []);
  const { data: list, reload } = usePoll(() => api.get('/settlements'), [], 8000);
  const [f, setF] = useState<any>({ communityId: '', date: new Date().toISOString().slice(0, 10) });
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail } = usePoll(async () => (openId ? api.get(`/settlements/${openId}`) : null), [openId], 8000);

  const run = async () => {
    try {
      const r = await api.post('/settlements/run', { communityId: f.communityId, date: f.date });
      setOpenId(r.id); toast(`清算完成：${r.items?.length ?? 0} 笔明细`, 'ok'); reload();
    } catch (e: any) { toast(e.message, 'err'); }
  };

  return (
    <div>
      <Card title="按小区 + 夜间日期合并清算">
        <div className="row">
          <div style={{ flex: 2 }}><label>小区</label>
            <select value={f.communityId} onChange={(e) => setF({ ...f, communityId: e.target.value })}>
              <option value="">选择</option>
              {(communities ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}（平台{c.platformRate * 100}% / 物业{c.propertyRate * 100}%）</option>)}
            </select>
          </div>
          <div><label>夜间日期</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn primary" onClick={run}>执行清算</button></div>
        </div>
      </Card>

      <div className="grid cols2">
        <Card title="历史批次">
          <table>
            <thead><tr><th>日期</th><th>小区</th><th>实收</th><th>业主</th><th>物业</th><th>平台</th><th></th></tr></thead>
            <tbody>
              {(list ?? []).map((s: any) => (
                <tr key={s.id}>
                  <td>{s.date}</td><td>{s.community.name}</td>
                  <td><Money n={s.totalCollected} /></td>
                  <td><Money n={s.ownerPayout} /></td>
                  <td><Money n={s.propertyFee} /></td>
                  <td><Money n={s.platformFee} /></td>
                  <td><button className="btn sm" onClick={() => setOpenId(s.id)}>明细</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {detail && (
          <Card title={`清算明细 ${detail.date}`} extra={<Tag v={detail.status} />}>
            <div className="kpis">
              <div className="kpi"><div className="v"><Money n={detail.totalCollected} /></div><div className="k">车主实付合计</div></div>
              <div className="kpi"><div className="v"><Money n={detail.ownerPayout} /></div><div className="k">业主收益</div></div>
              <div className="kpi"><div className="v"><Money n={detail.propertyFee} /></div><div className="k">物业服务费</div></div>
              <div className="kpi"><div className="v"><Money n={detail.platformFee} /></div><div className="k">平台抽成</div></div>
            </div>
            <div className="kpis" style={{ marginTop: 10 }}>
              <div className="kpi"><div className="v"><Money n={detail.totalCoupon} /></div><div className="k">优惠券(平台承担)</div></div>
              <div className="kpi"><div className="v"><Money n={detail.totalCompensation} /></div><div className="k">异常补偿</div></div>
              <div className="kpi"><div className="v"><Money n={detail.totalRefund} /></div><div className="k">申诉退款</div></div>
              <div className="kpi"><div className="v ok-text">
                ¥{(Number(detail.ownerPayout) + Number(detail.propertyFee) + Number(detail.platformFee)).toFixed(2)}
              </div><div className="k">三方分成合计=实收</div></div>
            </div>
            <h3>逐段占用解释</h3>
            {(detail.items ?? []).map((it: any) => (
              <div className="seg" key={it.id}>
                <b>[{it.plate}]</b> {it.spot.code} · {fmtDT(it.segmentStart)} → {fmtDT(it.segmentEnd)}
                <div className="small muted" style={{ margin: '4px 0' }}>{it.note}</div>
                <div className="small">
                  司机付 <Money n={it.paidByDriver} /> ｜ 业主 <Money n={it.ownerAmount} /> ｜
                  物业 <Money n={it.propertyAmount} /> ｜ 平台 <Money n={it.platformAmount} /> ｜
                  违约：{respLabel(it.responsibility)}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

function TraceTab() {
  const { data: logs } = usePoll(() => api.get('/audit/all'), [], 10000);
  const [q, setQ] = useState('');
  const [spotTimeline, setTimeline] = useState<any>(null);
  const { data: spots } = usePoll(() => api.get('/parking/spots'), []);
  const loadTimeline = async (spotId: string) => {
    if (!spotId) return setTimeline(null);
    setTimeline(await api.get(`/trace/spots/${spotId}/timeline`));
  };
  const filtered = (logs ?? []).filter((l: any) =>
    !q || l.action.includes(q) || l.refType.includes(q) || JSON.stringify(l.payload ?? {}).includes(q),
  );
  return (
    <div>
      <Card title="同一车位某晚的占用时间线（谁使用 / 谁支付 / 谁违约）">
        <div className="row">
          <div style={{ flex: 2 }}><label>车位</label>
            <select onChange={(e) => loadTimeline(e.target.value)}>
              <option value="">选择车位</option>
              {(spots ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select>
          </div>
        </div>
        {spotTimeline && (
          <div style={{ marginTop: 10 }}>
            <h3>预约</h3>
            {(spotTimeline.reservations ?? []).map((r: any) => (
              <div className="seg" key={r.id}>
                {r.plate} · {fmtDT(r.from)} → {fmtDT(r.to)} · <Tag v={r.status} />
              </div>
            ))}
            <h3>实际占用（绑定计费）</h3>
            {(spotTimeline.occupiedSegments ?? []).map((s: any, i: number) => (
              <div className="seg" key={i}>
                {s.plate} · {fmtDT(s.from)} → {s.to ? fmtDT(s.to) : '在库'} · <Tag v={s.status} /> · 入场识别 <Tag v={s.entryMatchType} />
                {s.billing && <div className="small" style={{ marginTop: 4 }}>
                  基础 <Money n={s.billing.baseFee} /> 超时 <Money n={s.billing.overtimeFee} />
                  挪车违约 <Money n={s.billing.moveDelayPenalty} /> 实付 <Money n={s.billing.payable} />
                </div>}
              </div>
            ))}
            {!spotTimeline.occupiedSegments?.length && <div className="muted small">暂无实际占用</div>}
          </div>
        )}
      </Card>
      <Card title={`全链路追溯日志（车位发布→预约→入场→异常→离场→分账，共 ${filtered.length} 条）`}>
        <input placeholder="过滤动作/资源/payload，如 reservation / gate / settle" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
        <div className="timeline" style={{ maxHeight: 460, overflow: 'auto' }}>
          {filtered.map((l: any) => (
            <div className="tl-item" key={l.id}>
              <b>{fmtDT(l.at)}</b> [{l.actorKind}] <b>{l.action}</b>{' '}
              <span className="muted">{l.refType}{l.refId ? `:${l.refId.slice(0, 8)}` : ''}</span>
              {l.payload && <pre className="explain" style={{ maxHeight: 120 }}>{JSON.stringify(l.payload, null, 1)}</pre>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

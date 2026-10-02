import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post } from '../api';

// 轻量 Toast
type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(t: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, text, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'ok' ? 'ok' : ''}`}>
          {t.text}
        </div>
      ))}
    </ToastCtx.Provider>
  );
}

export const STATUS_TAG: Record<string, string> = {
  pending: 'amber', approved: 'green',
  booked: 'blue', dispatched: 'purple', cancelled: 'gray', evicted: 'amber', completed: 'green',
  in: 'blue', out: 'green', force_closed: 'amber',
  open: 'red', notified: 'amber', resolved: 'blue', closed: 'green',
  upheld: 'green', partial: 'amber', rejected: 'red', under_review: 'blue',
  paid: 'green', unpaid: 'red', partial_refund: 'amber', refunded: 'gray', waived: 'gray',
  draft: 'gray', settled: 'green',
  matched: 'green', failed: 'red', manual: 'amber', unknown: 'gray',
  sent: 'amber', acknowledged: 'blue', moved: 'green', ignored: 'red',
};

export function Tag({ v, map }: { v: string; map?: Record<string, string> }) {
  const cls = (map ?? STATUS_TAG)[v] ?? 'gray';
  return <span className={`tag ${cls}`}>{v}</span>;
}

const INC_LABEL: Record<string, string> = {
  owner_return: '业主临时回家',
  visitor_overtime: '访客超时',
  stranger_occupation: '陌生车占位',
  recognition_failed: '道闸识别失败',
  weak_signal: '地库信号差',
  fuel_on_charger: '燃油车占充电位',
  manual_release: '物业人工放行',
};
export const incLabel = (t: string) => INC_LABEL[t] ?? t;

const RESP_LABEL: Record<string, string> = {
  driver: '车主', owner: '业主', platform_navigation: '平台导航',
  property: '物业', stranger: '陌生车辆', none: '无/待裁',
};
export const respLabel = (t: string) => RESP_LABEL[t] ?? t;

export function Card({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      {title && (
        <h2>
          <span style={{ flex: 1 }}>{title}</span>
          {extra}
        </h2>
      )}
      {children}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
      <span className="muted">{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export function Money({ n }: { n: number | string | null | undefined }) {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0;
  return <span className="money">¥{v.toFixed(2)}</span>;
}

export function Findings({ data }: { data: any }) {
  if (!data) return <span className="muted">无</span>;
  const chain: any[] = data.evidenceChain ?? [];
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{data.reason}</div>
      <ul className="findings">
        {chain.map((f, i) => (
          <li key={i}>
            <span className="src">[{f.source}]</span>
            {f.conclusion}
            <span className="muted">（权重 {f.weight}）</span>
          </li>
        ))}
      </ul>
      {data.billingExplanation && (
        <pre className="explain">{(data.billingExplanation as string[]).join('\n')}</pre>
      )}
    </div>
  );
}

// 演示用：datetime-local 值（按 UTC 解释）→ ISO
export function toISO(v: string): string {
  if (!v) return '';
  return new Date(v.length === 16 ? v + ':00Z' : v.endsWith('Z') ? v : v + 'Z').toISOString();
}
// slot date + 分钟 → datetime-local（UTC 文本）
export function slotToLocal(date: string, minute: number): string {
  const total = minute;
  const day = Math.floor(total / 1440);
  const d = new Date(new Date(date + 'T00:00:00Z').getTime() + day * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.toISOString().slice(0, 10)}T${p(Math.floor((total % 1440) / 60))}:${p(total % 60)}`;
}

// 数据加载/轮询
export function usePoll<T>(fn: () => Promise<T>, deps: any[], ms = 0) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && setData(d)).catch(() => {});
    const t = ms
      ? setInterval(() => fn().then((d) => alive && setData(d)).catch(() => {}), ms)
      : 0;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, reload };
}

// 页面统一用这个访问后端
export const api = { get, post };

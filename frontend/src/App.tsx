import React, { useEffect, useState } from 'react';
import { get, post, setToken } from './api';
import { ToastHost, useToast } from './components/ui';
import { OwnerPage } from './pages/OwnerPage';
import { DriverPage } from './pages/DriverPage';
import { PropertyPage } from './pages/PropertyPage';

const ACCOUNTS = [
  { username: 'owner', password: 'owner123', label: '业主·王建国' },
  { username: 'driver', password: 'driver123', label: '车主·李晓' },
  { username: 'driver2', password: 'driver123', label: '访客车主·赵访客' },
  { username: 'property', password: 'property123', label: '物业管家·张敏' },
  { username: 'admin', password: 'admin123', label: '平台管理员' },
];

function Login({ onLogin }: { onLogin: (u: any, t: string) => void }) {
  const toast = useToast();
  const [username, setU] = useState('owner');
  const [password, setP] = useState('owner123');
  const submit = async (u?: string, p?: string) => {
    try {
      const r = await post('/auth/login', { username: u ?? username, password: p ?? password });
      setToken(r.token);
      onLogin(r.user, r.token);
      toast(`欢迎，${r.user.displayName}`, 'ok');
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h2>🅿️ 社区共享停车平台</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          错停申诉 · 收益分账 · 夜间调度
        </div>
        <label>用户名</label>
        <input value={username} onChange={(e) => setU(e.target.value)} />
        <label>密码</label>
        <input type="password" value={password} onChange={(e) => setP(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => submit()}>
            登录
          </button>
        </div>
        <h3>演示账号（点击直达）</h3>
        <div className="accounts">
          {ACCOUNTS.map((a) => (
            <button key={a.username} className="btn sm" onClick={() => submit(a.username, a.password)}>
              {a.label} <span className="muted">({a.username} / {a.password})</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Shell({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [tab, setTab] = useState('work');
  const home =
    user.role === 'owner' ? 'work' : user.role === 'driver' ? 'work' : 'work';

  const tabs =
    user.role === 'owner'
      ? [['work', '业主工作台']]
      : user.role === 'driver'
        ? [['work', '车主工作台']]
        : [['work', '物业/管理工作台']];

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <div className="logo">🅿️</div>
          <div>
            <h1>社区共享停车 · 错停申诉 / 收益分账 / 夜间调度</h1>
            <small>朝阳景苑 · React + NestJS + PostgreSQL</small>
          </div>
        </div>
        <div className="tabs">
          {tabs.map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="userbox">
          <b>{user.displayName}</b>
          <span>{user.role}</span>
          {user.role === 'driver' && (
            <span>
              信用 <b className={user.creditScore >= 90 ? 'ok-text' : 'bad-text'}>{user.creditScore}</b>
            </span>
          )}
          <button className="btn sm" onClick={onLogout}>退出</button>
        </div>
      </div>
      {user.role === 'owner' && <OwnerPage user={user} />}
      {user.role === 'driver' && <DriverPage user={user} />}
      {(user.role === 'property' || user.role === 'admin') && <PropertyPage user={user} />}
      <span style={{ display: 'none' }}>{home}</span>
    </>
  );
}

// 定时/手动刷新数据
export function usePoll<T>(fn: () => Promise<T>, deps: any[], ms = 0) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && setData(d)).catch(() => {});
    const t = ms ? setInterval(() => fn().then((d) => alive && setData(d)).catch(() => {}), ms) : 0;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, reload };
}

export function ShellWithToast() {
  const [user, setUser] = useState<any>(() => {
    // 简单会话保持：仅内存
    return null;
  });
  return (
    <ToastHost>
      {user ? (
        <Shell user={user} onLogout={() => { setToken(null); setUser(null); }} />
      ) : (
        <Login onLogin={(u) => setUser(u)} />
      )}
    </ToastHost>
  );
}

export function App() {
  return <ShellWithToast />;
}

// 供页面调用的便捷封装
export const api = { get, post };

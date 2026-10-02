// API 客户端：JWT 存 localStorage，统一错误处理
export interface Session {
  accessToken: string;
  user: {
    id: number;
    username: string;
    name: string;
    role: 'owner' | 'driver' | 'property' | 'admin';
    phone?: string;
    creditScore: number;
  };
}

const TOKEN_KEY = 'parking_token';
const USER_KEY = 'parking_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getSession(): Session | null {
  const t = localStorage.getItem(TOKEN_KEY);
  const u = localStorage.getItem(USER_KEY);
  if (!t || !u) return null;
  try {
    return { accessToken: t, user: JSON.parse(u) };
  } catch {
    return null;
  }
}
export function setSession(s: Session) {
  localStorage.setItem(TOKEN_KEY, s.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(s.user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    const msg = typeof json === 'string' ? json : json?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('；') : msg);
  }
  return json as T;
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
};

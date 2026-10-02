// 全局枚举与常量

export type UserRole = 'owner' | 'driver' | 'property' | 'admin';
export const USER_ROLES = ['owner', 'driver', 'property', 'admin'] as const;

// 车位物业审核状态
export type SpotApproval = 'pending' | 'approved' | 'rejected';
export const SPOT_APPROVALS = ['pending', 'approved', 'rejected'] as const;

// 月租车优先规则
export type MonthlyPriority = 'none' | 'monthly_first';
// monthly_first: 非月租车仅能在共享时段开始前 24 小时内下单，优先保障月租车/业主夜间回家
export const MONTHLY_PRIORITIES = ['none', 'monthly_first'] as const;
export const MONTHLY_PRIORITY_HEADSTART_HOURS = 24;

// 预约状态
export type ReservationStatus =
  | 'booked' // 已预约
  | 'dispatched' // 夜间调度改派
  | 'cancelled' // 主动取消
  | 'evicted' // 业主提前回家被清退
  | 'completed'; // 已完成离场
export const RESERVATION_STATUSES = [
  'booked',
  'dispatched',
  'cancelled',
  'evicted',
  'completed',
] as const;

// 停车会话（入场—离场绑定同一笔停车服务）
export type SessionStatus = 'in' | 'out' | 'force_closed';
export const SESSION_STATUSES = ['in', 'out', 'force_closed'] as const;

// 道闸识别结果
export type GateMatchType =
  | 'matched' // 车牌识别命中预约
  | 'failed' // 识别失败
  | 'manual' // 物业人工放行
  | 'unknown'; // 无预约陌生车
export const GATE_MATCH_TYPES = ['matched', 'failed', 'manual', 'unknown'] as const;

// 夜间异常类型
export type IncidentType =
  | 'owner_return' // 业主临时回家
  | 'visitor_overtime' // 访客车辆超时
  | 'stranger_occupation' // 车位被陌生车辆占用
  | 'recognition_failed' // 道闸识别失败
  | 'weak_signal' // 地下车库信号差
  | 'fuel_on_charger' // 充电车位被燃油车占用
  | 'manual_release'; // 物业人工放行
export const INCIDENT_TYPES = [
  'owner_return',
  'visitor_overtime',
  'stranger_occupation',
  'recognition_failed',
  'weak_signal',
  'fuel_on_charger',
  'manual_release',
] as const;

export type IncidentStatus = 'open' | 'notified' | 'resolved' | 'closed';
export const INCIDENT_STATUSES = ['open', 'notified', 'resolved', 'closed'] as const;

// 申诉裁决结果
export type AppealStatus =
  | 'pending' // 待受理
  | 'under_review' // 核查中
  | 'upheld' // 申诉成立（车主无责或仅承担超时）
  | 'partial' // 部分成立（存在第三方原因，但车主确有超时/挪车迟延）
  | 'rejected'; // 申诉驳回（车主确实停错）
export const APPEAL_STATUSES = ['pending', 'under_review', 'upheld', 'partial', 'rejected'] as const;

// 责任归属
export type Responsibility =
  | 'driver' // 外来车主（确实停错/超时）
  | 'owner' // 业主（提前回家违约）
  | 'platform_navigation' // 平台导航/派单错误
  | 'property' // 物业（道闸/信号/人工疏导）
  | 'stranger' // 陌生占位车辆
  | 'none'; // 无责/混合豁免
export const RESPONSIBILITIES = [
  'driver',
  'owner',
  'platform_navigation',
  'property',
  'stranger',
  'none',
] as const;

// 挪车通知状态
export type MoveNoticeStatus = 'sent' | 'acknowledged' | 'moved' | 'ignored';
export const MOVE_NOTICE_STATUSES = ['sent', 'acknowledged', 'moved', 'ignored'] as const;

export type OrderKind = 'parking' | 'stranger_penalty';
export type OrderStatus = 'unpaid' | 'paid' | 'partial_refund' | 'refunded' | 'waived';
export const ORDER_STATUSES = ['unpaid', 'paid', 'partial_refund', 'refunded', 'waived'] as const;

export type SettlementStatus = 'draft' | 'settled';
export const SETTLEMENT_STATUSES = ['draft', 'settled'] as const;

export type VehicleType = 'ev' | 'fuel';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

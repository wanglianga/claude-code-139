// numeric(10,2) <-> number 转换
// - DB NULL（如可空自定义单价）在 JS 侧保持 null
// - 实体未赋值（undefined）入库时落 0，避免 NOT NULL 违约
export const numericColumn = {
  type: 'numeric' as const,
  precision: 10,
  scale: 2,
  default: 0,
  transformer: {
    to: (v?: number | null) => {
      if (v === undefined) return 0;
      return v; // null 保持 null
    },
    from: (v?: string | null) => (v === null || v === undefined ? null : parseFloat(v)),
  },
};

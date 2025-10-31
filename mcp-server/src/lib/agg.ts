import { LogEvent } from "../types";

export function aggregate(
  rows: LogEvent[],
  metric: { op: 'count'|'sum'|'avg'|'max'|'min', field?: string }
) {
  const nums = metric.field ? rows.map(r => Number((r as any)[metric.field!])).filter(n => !isNaN(n)) : [];
  switch (metric.op) {
    case 'count': return rows.length;
    case 'sum': return nums.reduce((a,b)=>a+b,0);
    case 'avg': return nums.length? nums.reduce((a,b)=>a+b,0)/nums.length : 0;
    case 'max': return nums.length? Math.max(...nums): undefined;
    case 'min': return nums.length? Math.min(...nums): undefined;
  }
}

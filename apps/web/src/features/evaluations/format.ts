const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 6 });
const percentage = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });

export function number(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未評価';
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(3);
  return decimal.format(value);
}

export function signed(value: number | null | undefined): string {
  return value == null ? '未評価' : `${value > 0 ? '+' : ''}${number(value)}`;
}

export function percent(value: number): string {
  return `${percentage.format(value * 100)}%`;
}

export function scientific(value: number): string {
  return value === 0 ? '0（保存値）' : value.toExponential(3);
}

export function timestamp(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '未確認';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

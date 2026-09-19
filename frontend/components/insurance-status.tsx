const names: Record<string, string> = {
  iu_processing: 'ĐHQT xử lý', waiting_bhxh: 'Chờ BHXH xử lý',
  issued: 'Phát hành', rejected: 'Từ chối',
};
const colors: Record<string, string> = {
  iu_processing: 'border-slate-200 bg-slate-100 text-slate-600',
  waiting_bhxh: 'border-blue-200 bg-blue-50 text-blue-700',
  issued: 'border-green-200 bg-green-50 text-green-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
};

export function InsuranceStatus({ status }: { status: string }) {
  return <span className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-semibold ${colors[status] || colors.iu_processing}`}>
    {names[status] || status}
  </span>;
}

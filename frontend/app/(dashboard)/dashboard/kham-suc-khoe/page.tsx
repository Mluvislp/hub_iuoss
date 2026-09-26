'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, CalendarClock, Check, ChevronRight, ClipboardCheck,
  ExternalLink, FileImage, HeartPulse, ImagePlus, Loader2, Lock, MapPin, Stethoscope, Upload, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { accentIcon, badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { HealthCheckResponse, HealthCheckState, Province } from '@/lib/types';
import {
  ChoiceTile, DeclarationFields, DeclarationSummary, useDeclarationDraft,
} from '../khai-bao-ngoai-tru/DeclarationForm';
import { FormBusy } from '@/components/form-busy';

const GUIDE_APP_URL =
  'https://medinet.hochiminhcity.gov.vn/kham-suc-khoe/so-y-te-tphcm-hay-cai-dat-va-theo-doi-suc-khoe-tron-doi-tren-ung-dung-cong-dan-cmobile16680-75572.aspx';
const GUIDE_VIDEO_URL = 'https://drive.google.com/file/d/15CmO2LdHQ47uKVma65nE_0z0mBJ-3hSb/view';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const MAX_BYTES = 5 * 1024 * 1024;

const STATUS_BADGE: Record<string, string> = {
  pending: badge.warning,
  approved: badge.success,
  rejected: badge.danger,
  registered: badge.info,
  attended: badge.success,
  absent: badge.neutral,
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' +
    d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function Breadcrumb() {
  return (
    <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
      <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
      <ChevronRight size={14} className="text-slate-400" />
      <span className="text-ink font-medium">Khám sức khỏe</span>
    </nav>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{text}
    </div>
  );
}

/** Hướng dẫn tra cứu kết quả khám trên ứng dụng Công dân số. */
function EvidenceGuide() {
  const link = 'inline-flex items-center gap-1 font-medium text-primary-text hover:underline';
  return (
    <div className="rounded-lg border border-line border-l-2 border-l-primary bg-slate-50 px-4 py-3 text-[0.84rem] text-ink space-y-2">
      <p>
        Sinh viên kiểm tra thông tin kết quả khám sức khỏe theo Chương trình khám sức khỏe
        toàn dân của Thành phố trên ứng dụng Công dân số Thành phố theo hướng dẫn của Sở Y tế
        Thành phố Hồ Chí Minh:{' '}
        <a href={GUIDE_APP_URL} target="_blank" rel="noopener noreferrer" className={link}>
          Xem hướng dẫn tại đây <ExternalLink size={12} />
        </a>
      </p>
      <p>
        Đối với sinh viên đã khám nhưng kết quả chưa hiển thị trên ứng dụng Công dân số, sinh
        viên thực hiện cập nhật kết quả đã khám theo video hướng dẫn:{' '}
        <a href={GUIDE_VIDEO_URL} target="_blank" rel="noopener noreferrer" className={link}>
          Xem video hướng dẫn <ExternalLink size={12} />
        </a>
      </p>
    </div>
  );
}

/** Ô chọn ảnh + xem trước. Kiểm dung lượng ở client cho nhanh; định dạng thật do server quyết. */
function EvidencePicker({
  files, onChange, max, error,
}: { files: File[]; onChange: (f: File[]) => void; max: number; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState('');
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    setLocalError('');
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) { setLocalError(`“${f.name}” vượt quá 5 MB.`); continue; }
      if (next.length >= max) { setLocalError(`Tối đa ${max} ảnh.`); break; }
      next.push(f);
    }
    onChange(next);
    if (input.current) input.current.value = '';
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {files.map((f, i) => (
          <div key={previews[i]} className="relative rounded-lg border border-line overflow-hidden bg-slate-50 aspect-[3/4]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previews[i]} alt={f.name} className="w-full h-full object-cover" />
            <button type="button" aria-label="Bỏ ảnh"
                    onClick={() => onChange(files.filter((_, j) => j !== i))}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-white/95 border border-line flex items-center justify-center text-muted hover:text-danger-text">
              <X size={14} />
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-white/95 border-t border-line px-2 py-1 text-[0.7rem] text-muted truncate">
              {f.name}
            </div>
          </div>
        ))}
        {files.length < max && (
          <button type="button" onClick={() => input.current?.click()}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed aspect-[3/4] text-muted hover:bg-slate-50 hover:text-ink transition-colors',
                    error || localError ? 'border-danger-line' : 'border-slate-300',
                  )}>
            <ImagePlus size={22} />
            <span className="text-[0.8rem] font-medium">Thêm ảnh</span>
            <span className="text-[0.7rem]">{files.length}/{max}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden"
             onChange={(e) => add(e.target.files)} />
      <p className="mt-2 text-[0.75rem] text-muted">
        Ảnh chụp màn hình kết quả khám trên ứng dụng Công dân số. JPG, PNG, WebP hoặc HEIC; tối đa {max} ảnh, mỗi ảnh không quá 5 MB.
      </p>
      {(error || localError) && (
        <p className="mt-1 text-[0.75rem] text-danger-text">{error || localError}</p>
      )}
    </div>
  );
}

/** Ảnh minh chứng đã nộp — tải qua fetch vì cần token. */
function EvidenceThumbs({ response }: { response: HealthCheckResponse }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    Promise.all(response.evidence.map((e) =>
      api.healthCheck.evidence(e.index).then((b) => {
        const u = URL.createObjectURL(b); made.push(u); return u;
      }).catch(() => null),
    )).then((list) => { if (alive) setUrls(list); });
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [response.id, response.submit_count, response.evidence]);

  if (!response.evidence.length) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {response.evidence.map((e, i) => (
        <a key={e.index} href={urls[i] || undefined} target="_blank" rel="noopener noreferrer"
           className="block rounded-lg border border-line overflow-hidden bg-slate-50 aspect-[3/4]">
          {urls[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[i]!} alt={e.name} className="w-full h-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-slate-400">
              <FileImage size={20} />
            </span>
          )}
        </a>
      ))}
    </div>
  );
}

/** Thông tin gói khám của đợt. */
function PackageInfo({ state }: { state: HealthCheckState }) {
  const r = state.round!;
  return (
    <div className="rounded-lg border border-line divide-y divide-line2 text-[0.86rem]">
      <div className="px-4 py-3">
        <div className="text-[0.75rem] font-medium text-muted mb-0.5">Tên gói</div>
        <div className="font-semibold text-ink">{r.package_name}</div>
      </div>
      <div className="px-4 py-3">
        <div className="text-[0.75rem] font-medium text-muted mb-1">Nội dung</div>
        <div className="space-y-1.5 text-ink leading-relaxed">
          {r.package_lines.map((l, i) => l.bullet ? (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-primary mt-[0.55em] w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              <span>{l.text}</span>
            </div>
          ) : (
            <p key={i}>{l.text}</p>
          ))}
        </div>
      </div>
      {r.schedule_note && (
        <div className="px-4 py-3 flex items-start gap-2">
          <CalendarClock size={15} className="text-primary mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-[0.75rem] font-medium text-muted mb-0.5">Thời gian và địa điểm dự kiến</div>
            <div className="text-ink">{r.schedule_note}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthCheckPage() {
  const [state, setState] = useState<HealthCheckState | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loadError, setLoadError] = useState('');
  const [choice, setChoice] = useState<'examined' | 'register' | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const draft = useDeclarationDraft(state?.offcampus ?? null);

  useEffect(() => {
    api.healthCheck.state()
      .then(setState)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
    api.locations.provinces().then(setProvinces).catch(() => {});
  }, []);

  const declarationLocked = state?.offcampus.locked ?? false;
  const hcm = state?.offcampus.hcmc_province_code ?? '79';
  // Điều kiện mở phần 2 tính TRỰC TIẾP từ ô đang nhập ở phần 1: SV chọn TP.HCM
  // để mở phần 2 rồi quay lên đổi địa chỉ khác → phần 2 khóa lại ngay và bỏ tích
  // đồng ý. Server vẫn tính lại từ địa chỉ đã ghi lúc nộp, không tin giá trị này.
  const eligible = declarationLocked
    ? !!state?.residence.eligible
    : draft.permanent.provinceCode === hcm || draft.inHcmc === true;
  useEffect(() => { if (!eligible) setConsent(false); }, [eligible]);

  if (loadError) return <div className="max-w-[860px]"><ErrorBox text={loadError} /></div>;
  if (!state) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={22} className="animate-spin mr-2" /> Đang tải…
      </div>
    );
  }

  const round = state.round;
  const response = state.response;

  const header = round && (
    <div className="px-6 py-5 border-b border-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <HeartPulse size={17} className="text-primary" /> {round.title}
          </h1>
          <p className="text-sm text-muted mt-1">
            Năm học {round.academic_year} · Thời hạn khai báo {fmtDateTime(round.opens_at)} – {fmtDateTime(round.closes_at)}
          </p>
        </div>
        {round.state === 'open' && (
          <span className={cn(badge.base, daysLeft(round.closes_at) <= 3 ? badge.warning : badge.info)}>
            <CalendarClock size={12} />
            {daysLeft(round.closes_at) <= 1 ? 'Hết hạn trong hôm nay' : `Còn ${daysLeft(round.closes_at)} ngày`}
          </span>
        )}
        {round.state === 'closed' && <span className={cn(badge.base, badge.neutral)}><Lock size={12} /> Đã kết thúc</span>}
        {round.state === 'upcoming' && <span className={cn(badge.base, badge.neutral)}>Chưa mở</span>}
      </div>
    </div>
  );

  // ── Chưa có đợt nào ──
  if (!round) {
    return (
      <div className="max-w-[860px] space-y-4">
        <Breadcrumb />
        <div className={cn(ui.card, 'p-8 text-center')}>
          <HeartPulse size={26} className="mx-auto text-slate-400 mb-3" />
          <h2 className="text-base font-semibold text-ink">Chưa có đợt khai báo khám sức khỏe</h2>
          <p className="text-sm text-muted mt-1">Thông tin sẽ được cập nhật khi Nhà trường mở đợt khai báo.</p>
        </div>
      </div>
    );
  }

  // ── Đã có phản hồi: xem lại (+ nộp lại minh chứng nếu bị từ chối) ──
  if (response) {
    return (
      <div className="max-w-[860px] space-y-4">
        <Breadcrumb />
        {justSubmitted && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-success-soft border border-success-line text-success-text text-sm">
            <Check size={16} className="flex-shrink-0 mt-0.5" />
            {response.choice === 'register' ? 'Đã ghi nhận đăng ký khám sức khỏe.' : 'Đã ghi nhận minh chứng.'}
          </div>
        )}
        <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
          {header}
          <div className="px-6 py-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[0.75rem] font-medium text-muted">Phản hồi đã gửi</div>
                <div className="text-sm font-semibold text-ink mt-0.5">
                  {response.choice === 'register'
                    ? 'Chưa khám — đăng ký khám tập trung tại trường'
                    : 'Đã khám theo chương trình của Thành phố'}
                </div>
              </div>
              <span className={cn(badge.base, STATUS_BADGE[response.status] ?? badge.neutral)}>
                {response.status_label}
              </span>
            </div>

            <div className="rounded-lg border border-line px-4 py-1">
              <div className={ui.dtRow}>
                <span className={ui.dtLabel}>Thời điểm gửi</span>
                <span className={ui.dtValue}>
                  {fmtDateTime(response.submitted_at)}
                  {response.submit_count > 1 ? ` (lần ${response.submit_count})` : ''}
                </span>
              </div>
              {response.consent_at && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Đồng ý tham gia khám</span>
                  <span className={ui.dtValue}>{fmtDateTime(response.consent_at)}</span>
                </div>
              )}
              {response.residence && response.choice === 'register' && (
                <>
                  <div className={ui.dtRow}>
                    <span className={ui.dtLabel}>Thường trú</span>
                    <span className={ui.dtValue}>{response.residence.permanent || '—'}</span>
                  </div>
                  <div className={ui.dtRow}>
                    <span className={ui.dtLabel}>Tạm trú</span>
                    <span className={ui.dtValue}>{response.residence.temporary || '—'}</span>
                  </div>
                </>
              )}
              {response.reviewed_at && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Thời điểm xử lý</span>
                  <span className={ui.dtValue}>{fmtDateTime(response.reviewed_at)}</span>
                </div>
              )}
            </div>

            {response.review_note && (
              <div className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                response.status === 'rejected'
                  ? 'bg-danger-soft border-danger-line text-danger-text'
                  : 'bg-slate-50 border-line text-ink',
              )}>
                <div className="font-semibold mb-0.5">Ghi chú của Phòng Công tác Sinh viên</div>
                {response.review_note}
              </div>
            )}

            {response.choice === 'register' && <PackageInfo state={state} />}

            {response.choice === 'examined' && (
              <div>
                <div className="text-[0.82rem] font-medium text-ink mb-2">Minh chứng đã nộp</div>
                <EvidenceThumbs response={response} />
              </div>
            )}

            {state.can_resubmit && (
              <form
                className="pt-4 border-t border-line2 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!files.length) { setFieldError({ evidence: 'Chưa có ảnh nào.' }); return; }
                  setSaving(true); setError(''); setFieldError({});
                  try {
                    const fd = new FormData();
                    files.forEach((f) => fd.append('files', f));
                    setState(await api.healthCheck.submitEvidence(fd));
                    setFiles([]); setJustSubmitted(true);
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Không gửi được minh chứng.');
                  } finally { setSaving(false); }
                }}
              >
                <FormBusy busy={saving} label="Đang tải ảnh lên…" className="space-y-4">
                  <h2 className={ui.sectionTitle}>
                    <Upload size={16} className={accentIcon.primary} /> Nộp lại minh chứng
                  </h2>
                  {error && <ErrorBox text={error} />}
                  <EvidenceGuide />
                  <EvidencePicker files={files} onChange={(f) => { setFiles(f); setFieldError({}); }}
                                  max={state.max_evidence_files} error={fieldError.evidence} />
                  <div className="flex justify-end">
                    <button type="submit" disabled={saving} className={ui.btnPrimary}>
                      {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</> : 'Gửi lại minh chứng'}
                    </button>
                  </div>
                </FormBusy>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Chưa trả lời mà đợt không mở ──
  if (!state.can_submit) {
    return (
      <div className="max-w-[860px] space-y-4">
        <Breadcrumb />
        <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
          {header}
          <div className="px-6 py-6 text-sm text-muted">
            {round.state === 'upcoming'
              ? `Đợt khai báo mở lúc ${fmtDateTime(round.opens_at)}.`
              : `Đợt khai báo đã kết thúc lúc ${fmtDateTime(round.closes_at)}. Không ghi nhận phản hồi cho đợt này.`}
          </div>
        </div>
      </div>
    );
  }

  // ── Đợt đang mở, chưa trả lời ──
  async function submitEvidence(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setFieldError({});
    if (!files.length) { setFieldError({ evidence: 'Chưa có ảnh nào.' }); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      setState(await api.healthCheck.submitEvidence(fd));
      setFiles([]); setJustSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.data?.errors) setFieldError(err.data.errors as Record<string, string>);
      setError(err instanceof ApiError ? err.message : 'Không gửi được minh chứng.');
    } finally { setSaving(false); }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(''); draft.setFieldErrors({});
    if (!declarationLocked) {
      const local = draft.validate();
      if (Object.keys(local).length) {
        draft.setFieldErrors(local);
        setError('Vui lòng kiểm tra lại các ô được đánh dấu ở phần 1.');
        return;
      }
    }
    if (!eligible) { setError('Phần đăng ký khám chưa được mở.'); return; }
    if (!consent) { setError('Vui lòng tích xác nhận đồng ý tham gia khám sức khỏe tập trung.'); return; }
    setSaving(true);
    try {
      setState(await api.healthCheck.register({
        declaration: declarationLocked ? undefined : draft.payload(),
        consent: true,
      }));
      setJustSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.data?.errors) {
        draft.setFieldErrors(err.data.errors as Record<string, string>);
      }
      setError(err instanceof ApiError ? err.message : 'Không gửi được đăng ký.');
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-[860px] space-y-4">
      <Breadcrumb />

      <div className={cn(ui.card, 'border-t-2 border-t-primary')}>
        {header}
        <div className="px-6 py-5">
          <p className="text-[0.9rem] font-semibold text-ink mb-3">
            Sinh viên đã khám sức khỏe định kỳ theo chỉ thị của Ủy ban Nhân dân Thành phố
            Hồ Chí Minh hay chưa?<span className="text-red-500"> *</span>
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <ChoiceTile active={choice === 'examined'} title="Đã khám rồi"
                        desc="Nộp ảnh minh chứng kết quả khám"
                        onClick={() => { setChoice('examined'); setError(''); }} />
            <ChoiceTile active={choice === 'register'} title="Chưa khám"
                        desc="Đăng ký khám sức khỏe tập trung tại trường"
                        onClick={() => { setChoice('register'); setError(''); }} />
          </div>
        </div>
      </div>

      {/* ── Nhánh "Đã khám rồi" ── */}
      {choice === 'examined' && (
        <form onSubmit={submitEvidence} className={ui.card}>
          <FormBusy busy={saving} label="Đang tải ảnh lên…" className="px-6 py-5 space-y-4">
            <h2 className={ui.sectionTitle}>
              <Upload size={16} className={accentIcon.primary} /> Nộp minh chứng đã khám
            </h2>
            {error && <ErrorBox text={error} />}
            <EvidencePicker files={files} onChange={(f) => { setFiles(f); setFieldError({}); }}
                            max={state.max_evidence_files} error={fieldError.evidence} />
            <EvidenceGuide />
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-line2">
              <button type="submit" disabled={saving} className={cn(ui.btnPrimary, 'mt-3')}>
                {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</> : 'Gửi minh chứng'}
              </button>
            </div>
          </FormBusy>
        </form>
      )}

      {/* ── Nhánh "Chưa khám": phần 1 khai báo + phần 2 đăng ký ── */}
      {choice === 'register' && (
        <form onSubmit={submitRegister} className="space-y-4">
          <FormBusy busy={saving} label="Đang gửi đăng ký…" className="space-y-4">
            {error && <ErrorBox text={error} />}

            <div className={ui.card}>
              <div className="px-6 py-4 border-b border-line">
                <h2 className={ui.sectionTitle}>
                  <span className="w-6 h-6 rounded-md border border-primary-line bg-primary-soft text-primary-text text-[0.75rem] font-bold flex items-center justify-center">1</span>
                  Khai báo thông tin cá nhân
                </h2>
                <p className="text-[0.78rem] text-muted mt-1">
                  {declarationLocked
                    ? 'Thông tin đã khai báo ngoại trú, không chỉnh sửa tại đây.'
                    : 'Thông tin gửi kèm đăng ký được ghi nhận là khai báo ngoại trú.'}
                </p>
              </div>
              <div className="px-6 py-5 space-y-7">
                {declarationLocked
                  ? <DeclarationSummary form={state.offcampus} />
                  : <DeclarationFields form={state.offcampus} draft={draft} provinces={provinces} />}
              </div>
            </div>

            <div className={cn(ui.card, !eligible && 'bg-slate-50')}>
              <div className="px-6 py-4 border-b border-line">
                <h2 className={cn(ui.sectionTitle, !eligible && 'text-muted')}>
                  <span className={cn(
                    'w-6 h-6 rounded-md border text-[0.75rem] font-bold flex items-center justify-center',
                    eligible ? 'border-primary-line bg-primary-soft text-primary-text' : 'border-line bg-white text-slate-400',
                  )}>2</span>
                  Thông tin và đăng ký khám
                  {!eligible && <Lock size={14} className="text-slate-400" />}
                </h2>
              </div>

              {!eligible ? (
                <div className="px-6 py-5">
                  <div role="alert" className="flex items-start gap-3 rounded-lg border border-warning-line border-l-4 border-l-warning-text bg-warning-soft px-4 py-3.5">
                    <AlertTriangle size={20} className="text-warning-text flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-warning-text">
                      <div className="font-semibold">Phần đăng ký khám chưa mở</div>
                      <p className="mt-1">
                        Chỉ sinh viên có địa chỉ <b>thường trú</b> hoặc <b>tạm trú</b> tại Thành phố
                        Hồ Chí Minh mới đăng ký được khám sức khỏe tập trung tại trường.
                      </p>
                      {declarationLocked ? (
                        <p className="mt-1">
                          Địa chỉ đã khai không thuộc Thành phố Hồ Chí Minh. Cần cập nhật địa chỉ thì gửi
                          yêu cầu chỉnh sửa tại{' '}
                          <Link href="/dashboard/khai-bao-ngoai-tru" className="font-semibold underline">Khai báo ngoại trú</Link>.
                        </p>
                      ) : (
                        <p className="mt-1">Địa chỉ đang khai ở phần 1 không thuộc Thành phố Hồ Chí Minh.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-5 space-y-4">
                  <div className="flex items-center gap-2 text-[0.8rem] text-success-text">
                    <MapPin size={14} />
                    {(declarationLocked ? state.residence.permanent_hcm : draft.permanent.provinceCode === hcm)
                      && (declarationLocked ? state.residence.temporary_hcm : draft.inHcmc === true)
                      ? 'Thường trú và tạm trú tại Thành phố Hồ Chí Minh'
                      : (declarationLocked ? state.residence.permanent_hcm : draft.permanent.provinceCode === hcm)
                        ? 'Thường trú tại Thành phố Hồ Chí Minh'
                        : 'Tạm trú tại Thành phố Hồ Chí Minh'}
                  </div>
                  <PackageInfo state={state} />
                  <label className={cn(
                    'flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                    consent ? 'border-primary bg-primary-soft' : 'border-line hover:bg-slate-50',
                  )}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                           className="mt-0.5 w-4 h-4 accent-[#2563eb]" />
                    <span className="text-sm font-medium text-ink">
                      Đồng ý tham gia khám sức khỏe tập trung theo kế hoạch của Nhà trường
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-line2">
                <Link href="/dashboard" className={ui.btnGhost}>Hủy</Link>
                <button type="submit" disabled={saving || !eligible || !consent} className={ui.btnPrimary}>
                  {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</>
                          : <><ClipboardCheck size={15} /> Gửi đăng ký khám</>}
                </button>
              </div>
            </div>
          </FormBusy>
        </form>
      )}

      {!choice && (
        <p className="flex items-center gap-2 text-[0.8rem] text-muted px-1">
          <Stethoscope size={14} /> Chọn một phương án để tiếp tục.
        </p>
      )}
    </div>
  );
}

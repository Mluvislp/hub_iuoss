'use client';

/* Nhánh "Đã khám rồi": khai lại kết quả khám theo mẫu KSK, chia 5 bước.
     1. Thông tin cá nhân — form khai báo ngoại trú (đã khai thì chỉ xem). Bấm
        "Lưu và tiếp tục" là GỬI khai báo ngay qua /api/offcampus/, không đợi
        tới bước cuối — khai xong form ngoại trú khóa lại như khai ở trang riêng.
     2–4. Lần khám · Khám lâm sàng · Cận lâm sàng — dựng từ result_schema
     5. Kết luận + ảnh minh chứng
   Chống nản: điền sẵn mọi giá trị mặc định được, xét nghiệm chi tiết gập lại và
   không bắt buộc, nháp tự lưu trên máy (tải lại trang không mất). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { HealthCheckState, Province } from '@/lib/types';
import { DeclarationFields, DeclarationSummary, useDeclarationDraft } from '../khai-bao-ngoai-tru/DeclarationForm';
import { FormBusy } from '@/components/form-busy';
import { EvidenceGuide, EvidencePicker } from './Evidence';
import CccdForm from './CccdForm';
import ConsentBox from './ConsentBox';
import ResultSectionFields, {
  ResultValues, sectionFields, suggestHealthClass, validateSection,
} from './ResultFields';

interface Props {
  state: HealthCheckState;
  provinces: Province[];
  /** Nộp lại sau khi bị từ chối: nạp kết quả đã khai lần trước. */
  resubmit?: boolean;
  onDone: (next: HealthCheckState) => void;
  /** Cập nhật state trang mà không coi là đã nộp — dùng sau khi lưu khai báo ở bước 1. */
  onStateChange: (next: HealthCheckState) => void;
  onCancel?: () => void;
}

/** Nháp chỉ giữ ô SV đã TỰ SỬA (khác mặc định lúc gõ). Lưu cả mặc định thì mỗi lần
 *  đổi mặc định ở backend, nháp cũ lại nạp ngược giá trị cũ — đã dính với thị lực 10. */
interface Draft { edited: ResultValues; healthTouched: boolean }

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch { return null; }
}

export default function ExaminedWizard({
  state, provinces, resubmit, onDone, onStateChange, onCancel,
}: Props) {
  const schema = state.result_schema;
  const locked = state.offcampus.locked;
  // Có phiên bản danh mục trong khóa: đổi mẫu (KSK → PYT) thì nháp cũ tự bị bỏ, không
  // nạp giá trị cũ sai kiểu vào ô mới (đã dính: thị lực "10/10" → lỗi "Phải là số").
  const draftKey = `hc-draft:pyt3:${state.round?.id}:${state.offcampus.student.student_code}`;
  const steps = useMemo(() => [
    { key: 'declaration', title: 'Thông tin cá nhân' },
    ...schema.map((s) => ({ key: s.key, title: s.title })),
  ], [schema]);

  const declaration = useDeclarationDraft(state.offcampus);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [values, setValues] = useState<ResultValues>(() => {
    const saved = readDraft(draftKey);
    const previous = resubmit ? state.response?.result ?? {} : {};
    // Chỉ nhận các khóa còn trong danh mục hiện hành.
    const known = (v: ResultValues) => Object.fromEntries(
      Object.entries(v).filter(([k]) => k in state.result_defaults));
    return { ...state.result_defaults, ...known(previous), ...known(saved?.edited ?? {}) };
  });
  // Phân loại sức khỏe tự theo phân loại cao nhất — cho tới khi SV tự chọn tay.
  const [healthTouched, setHealthTouched] = useState(() => readDraft(draftKey)?.healthTouched ?? !!resubmit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  // Cam kết + đồng ý cung cấp thông tin — không lưu vào nháp, mỗi lần gửi phải tích lại.
  const [dataConsent, setDataConsent] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const edited = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== (state.result_defaults[k] ?? '')));
    try { localStorage.setItem(draftKey, JSON.stringify({ edited, healthTouched })); } catch { /* bộ nhớ bị chặn */ }
  }, [draftKey, values, healthTouched, state.result_defaults]);

  useEffect(() => {
    if (healthTouched) return;
    const suggested = suggestHealthClass(schema, values);
    if (values.health_class !== suggested) setValues((v) => ({ ...v, health_class: suggested }));
  }, [schema, values, healthTouched]);

  const set = (k: string, v: string) => {
    if (k === 'health_class') setHealthTouched(true);
    setValues((cur) => ({ ...cur, [k]: v }));
    setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  };

  const goTo = (i: number) => {
    setStep(i);
    setReached((r) => Math.max(r, i));
    setError('');
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function validateStep(i: number): boolean {
    if (i === 0) {
      if (locked) {
        if (state.cccd_missing) { setError('Bổ sung số CCCD trước khi tiếp tục.'); return false; }
        return true;
      }
      const local = declaration.validate({ requireCccd: true });
      declaration.setFieldErrors(local);
      if (Object.keys(local).length) { setError('Vui lòng kiểm tra lại các ô được đánh dấu.'); return false; }
      return true;
    }
    const local = validateSection(schema[i - 1], values);
    setErrors((e) => ({ ...e, ...local }));
    if (Object.keys(local).length) { setError('Vui lòng kiểm tra lại các ô được đánh dấu.'); return false; }
    return true;
  }

  /** Bước 1 chưa khai: gửi khai báo ngoại trú ngay rồi mới sang bước 2. */
  async function saveDeclaration() {
    if (!validateStep(0)) return;
    setSaving(true); setBusyLabel('Đang lưu thông tin khai báo…'); setError('');
    try {
      await api.offcampus.submit(declaration.payload({ requireCccd: true }));
      onStateChange(await api.healthCheck.state());
      goTo(1);
    } catch (e) {
      if (e instanceof ApiError && e.data?.errors) {
        declaration.setFieldErrors(e.data.errors as Record<string, string>);
        setError('Vui lòng kiểm tra lại các ô được đánh dấu.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Không lưu được thông tin khai báo.');
      }
    } finally { setSaving(false); }
  }

  function next() {
    if (step === 0 && !locked) { saveDeclaration(); return; }
    if (validateStep(step)) goTo(step + 1);
  }

  async function submit() {
    for (let i = 0; i < steps.length; i++) {
      if (!validateStep(i)) { goTo(i); return; }
    }
    if (!files.length) { setErrors((e) => ({ ...e, evidence: 'Chưa có ảnh nào.' })); setError('Vui lòng tải lên ảnh minh chứng.'); return; }
    if (!dataConsent) {
      setErrors((e) => ({ ...e, data_consent: 'Chưa xác nhận.' }));
      setError('Vui lòng tích xác nhận cam kết và đồng ý cung cấp thông tin.');
      return;
    }
    setSaving(true); setBusyLabel('Đang gửi kết quả khám…'); setError('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('result', JSON.stringify(values));
      fd.append('data_consent', 'true');
      if (!locked) fd.append('declaration', JSON.stringify(declaration.payload()));
      const next = await api.healthCheck.submitEvidence(fd);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      onDone(next);
    } catch (e) {
      const errs = (e instanceof ApiError && e.data?.errors) as Record<string, string> | undefined;
      if (errs) {
        const resultErrs: Record<string, string> = {};
        const declErrs: Record<string, string> = {};
        Object.entries(errs).forEach(([k, v]) => {
          if (k.startsWith('result.')) resultErrs[k.slice(7)] = v;
          else if (k === 'evidence' || k === 'data_consent') resultErrs[k] = v;
          else declErrs[k] = v;
        });
        setErrors((cur) => ({ ...cur, ...resultErrs }));
        declaration.setFieldErrors(declErrs);
        // Nhảy về bước đầu tiên có lỗi.
        const first = Object.keys(declErrs).length ? 0
          : schema.findIndex((s) => sectionFields(s).some((f) => resultErrs[f.key])) + 1;
        if (first > 0 || Object.keys(declErrs).length) goTo(first);
      }
      setError(e instanceof ApiError ? e.message : 'Không gửi được kết quả khám.');
    } finally { setSaving(false); }
  }

  const last = step === steps.length - 1;
  const section = step > 0 ? schema[step - 1] : null;

  return (
    <div ref={top} className={cn(ui.card, 'scroll-mt-4')}>
      {/* ── Thanh bước ── */}
      <div className="px-6 pt-5 pb-4 border-b border-line">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-[0.72rem] font-medium text-muted">Bước {step + 1}/{steps.length}</div>
            <h2 className="text-[0.98rem] font-semibold text-ink">{steps[step].title}</h2>
          </div>
          {onCancel && <button type="button" onClick={onCancel} className="touch-target text-[0.8rem] text-muted hover:text-ink">Hủy</button>}
        </div>
        <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => {
            const done = i < step || (i <= reached && i !== step);
            return (
              <li key={s.key}>
                <button type="button" disabled={i > reached || saving || (step === 0 && !locked && i > 0)}
                        onClick={() => { if (i < step || validateStep(step)) goTo(i); }}
                        className="w-full text-left disabled:cursor-default group" title={s.title}>
                  <span className={cn('block h-1.5 rounded-full transition-colors',
                    i === step ? 'bg-primary' : done ? 'bg-primary/40' : 'bg-slate-200')} />
                  <span className={cn('hidden md:flex items-center gap-1 mt-1.5 text-[0.72rem] truncate',
                    i === step ? 'text-primary-text font-semibold' : 'text-muted')}>
                    {done && <Check size={11} />}{s.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <FormBusy busy={saving} label={busyLabel} className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
          </div>
        )}

        {step === 0 && (
          <div className="space-y-6">
            {locked ? (
              <p className="text-[0.8rem] text-muted">Thông tin đã khai báo ngoại trú, không chỉnh sửa tại đây.</p>
            ) : (
              <div className="rounded-lg border border-line border-l-2 border-l-primary bg-slate-50 px-4 py-2.5 text-[0.8rem] text-ink">
                Bấm <b>Lưu và tiếp tục</b> là thông tin được ghi nhận ngay thành khai báo ngoại trú.
                Cần sửa sau đó thì gửi yêu cầu chỉnh sửa tại mục Khai báo ngoại trú.
              </div>
            )}
            {locked && state.cccd_missing && <CccdForm onSaved={(next) => { onStateChange(next); setError(''); }} />}
            {locked ? <DeclarationSummary form={state.offcampus} />
              : <DeclarationFields form={state.offcampus} draft={declaration} provinces={provinces} />}
          </div>
        )}

        {section && (
          <>
            <p className="text-[0.8rem] text-muted -mt-1">{section.desc}</p>
            <ResultSectionFields section={section} values={values} set={set} errors={errors} />
          </>
        )}

        {last && (
          <section className="space-y-3 pt-2">
            <h3 className="text-[0.84rem] font-semibold text-ink">Ảnh minh chứng<span className="text-red-500"> *</span></h3>
            <EvidencePicker files={files} max={state.max_evidence_files} error={errors.evidence}
                            onChange={(f) => { setFiles(f); setErrors(({ evidence: _, ...rest }) => rest); }} />
            <EvidenceGuide hcmc={state.residence.eligible}
                           year={(state.round?.academic_year ?? '').split('-')[0]} />
          </section>
        )}

        {last && (
          <ConsentBox checked={dataConsent} text={state.data_consent_text.examined}
                      error={errors.data_consent}
                      onChange={(v) => { setDataConsent(v); setErrors(({ data_consent: _, ...rest }) => rest); }} />
        )}

        <div className="flex items-center justify-between gap-2 pt-4 border-t border-line2">
          {step > 0
            ? <button type="button" className={ui.btnGhost} onClick={() => goTo(step - 1)}><ArrowLeft size={15} /> Quay lại</button>
            : <span className="text-[0.72rem] text-muted">Nháp được lưu tự động trên thiết bị này.</span>}
          {last ? (
            <button type="button" className={ui.btnPrimary} disabled={saving || !dataConsent} onClick={submit}>
              {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</>
                : <><Send size={15} /> {resubmit ? 'Gửi lại kết quả khám' : 'Gửi kết quả khám'}</>}
            </button>
          ) : (
            <button type="button" className={ui.btnPrimary} disabled={saving} onClick={next}>
              {saving ? <><Loader2 size={15} className="animate-spin" /> Đang lưu…</>
                : <>{step === 0 && !locked ? 'Lưu và tiếp tục' : 'Tiếp tục'} <ArrowRight size={15} /></>}
            </button>
          )}
        </div>
      </FormBusy>
    </div>
  );
}

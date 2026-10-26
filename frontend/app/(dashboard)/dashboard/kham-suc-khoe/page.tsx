'use client';

import { RejectionNotice } from '@/components/rejection-notice';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, CalendarClock, Check, ChevronRight, ClipboardCheck,
  HeartPulse, Loader2, Lock, MapPin, PencilLine, Repeat, Stethoscope, Users,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { badge, ui } from '@/lib/ui';
import { cn } from '@/lib/utils';
import type { HealthCheckOptionState, HealthCheckResponse, HealthCheckState, Province } from '@/lib/types';
import {
  ChoiceTile, DeclarationFields, DeclarationSummary, useDeclarationDraft,
} from '../khai-bao-ngoai-tru/DeclarationForm';
import { FormBusy } from '@/components/form-busy';
import { EvidenceThumbs } from './Evidence';
import ExaminedWizard from './ExaminedWizard';
import CccdForm from './CccdForm';
import ConsentBox from './ConsentBox';
import SlotPicker from './SlotPicker';
import ExamTicket from './ExamTicket';

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
          <CalendarClock size={15} className="text-slate-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-[0.75rem] font-medium text-muted mb-0.5">Thời gian và địa điểm dự kiến</div>
            <div className="text-ink">{r.schedule_note}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Đối tượng khám tập trung tại trường — câu chữ ở backend `health_check.EXAM_ELIGIBILITY`. */
function EligibilityInfo({ state }: { state: HealthCheckState }) {
  const e = state.exam_eligibility;
  return (
    <div className="rounded-lg border border-line px-4 py-3 text-[0.86rem]">
      <div className="flex items-center gap-1.5 text-[0.75rem] font-medium text-muted mb-1">
        <Users size={14} className="text-slate-500" /> Đối tượng khám
      </div>
      <p className="text-ink">{e.intro}</p>
      <div className="space-y-1.5 text-ink leading-relaxed mt-1.5">
        {e.items.map((item, i) => (
          <div key={i} className="flex gap-2 pl-1">
            <span className="mt-[0.55em] w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ô lựa chọn: đang mở → bấm chọn được; không mở → làm mờ + nhãn ("Hết thời hạn đăng ký"…), không ẩn. */
function OptionTile({ option, active, title, desc, onClick }: {
  option: HealthCheckOptionState; active: boolean; title: string; desc: string; onClick: () => void;
}) {
  if (option.open) return <ChoiceTile active={active} title={title} desc={desc} onClick={onClick} />;
  return (
    <div aria-disabled="true"
         className="flex items-start gap-3 w-full text-left px-4 py-3 rounded-lg border border-line bg-slate-50 opacity-75 cursor-not-allowed">
      <span className="mt-0.5 w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
      <span>
        <span className="block text-sm font-semibold text-slate-500">{title}</span>
        <span className="block text-[0.78rem] text-slate-400 mt-0.5">{desc}</span>
        <span className="inline-flex items-center gap-1 mt-1.5 rounded border border-line bg-white px-1.5 py-0.5 text-[0.72rem] font-semibold text-slate-600">
          <Lock size={11} /> {option.label}
        </span>
      </span>
    </div>
  );
}

/** Tóm tắt kết quả khám SV đã khai — các chỉ số chính, đủ để tự kiểm lại. */
function ResultSummary({ response }: { response: HealthCheckResponse }) {
  const r = response.result || {};
  if (!Object.keys(r).length) return null;
  const rows: [string, string][] = [
    ['Ngày khám', r.exam_date ? new Date(r.exam_date).toLocaleDateString('vi-VN') : ''],
    ['Nơi khám', r.exam_place],
    ['Chiều cao · cân nặng · BMI', [r.height_cm && `${r.height_cm} cm`, r.weight_kg && `${r.weight_kg} kg`, r.bmi && `BMI ${r.bmi}`].filter(Boolean).join(' · ')],
    ['Nhịp tim · huyết áp', [r.pulse && `${r.pulse} lần/phút`, r.blood_pressure && `${r.blood_pressure} mmHg`].filter(Boolean).join(' · ')],
    ['Phân loại thể lực · sức khỏe', [r.physical_class && `Loại ${r.physical_class}`, r.health_class].filter(Boolean).join(' · ')],
    ['Kết luận của bác sĩ', r.doctor_conclusion],
    ['Các bệnh, tật', r.diseases],
  ];
  return (
    <div>
      <div className="text-[0.82rem] font-medium text-ink mb-2">Kết quả khám đã khai</div>
      <div className="rounded-lg border border-line px-4 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className={ui.dtRow}>
            <span className={ui.dtLabel}>{k}</span>
            <span className={ui.dtValue}>{v || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HealthCheckPage() {
  const [state, setState] = useState<HealthCheckState | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [loadError, setLoadError] = useState('');
  const [choice, setChoice] = useState<'examined' | 'register' | 'other' | null>(null);
  const [consent, setConsent] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [examSlot, setExamSlot] = useState('');
  const [slotError, setSlotError] = useState('');
  const [error, setError] = useState('');
  const [resubmitting, setResubmitting] = useState(false);
  // Đã khai "đã khám" (chưa được xác nhận) → chuyển sang đăng ký khám tại trường.
  const [switching, setSwitching] = useState(false);
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
            <HeartPulse size={17} className="text-slate-500" /> {round.title}
          </h1>
          <p className="text-sm text-muted mt-1">
            Năm học {round.academic_year}
          </p>
        </div>
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

  const done = (next: HealthCheckState) => {
    setState(next); setJustSubmitted(true); setResubmitting(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Chỉ coi là đang chuyển khi server vẫn cho phép (đợt mở, khai báo cũ chưa được xác nhận).
  const isSwitching = switching && !!response && state.can_switch_to_register;
  const startSwitch = () => {
    setSwitching(true); setChoice('register'); setJustSubmitted(false);
    setConsent(false); setDataConsent(false); setExamSlot(''); setSlotError(''); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelSwitch = () => {
    setSwitching(false); setChoice(null); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Nộp lại sau khi bị từ chối: đi lại toàn bộ các bước, nạp sẵn lần khai trước ──
  if (response && resubmitting && state.can_resubmit) {
    return (
      <div className="max-w-[860px] space-y-4">
        <Breadcrumb />
        {response.review_note && (
          <div className="rounded-lg border px-4 py-3 text-sm bg-danger-soft border-danger-line text-danger-text">
            <div className="font-semibold mb-0.5">Lý do chưa hợp lệ</div>{response.review_note}
          </div>
        )}
        <ExaminedWizard state={state} provinces={provinces} resubmit onDone={done}
                        choice={response.choice === 'other' ? 'other' : 'examined'}
                        onStateChange={setState} onCancel={() => setResubmitting(false)} />
      </div>
    );
  }

  // ── Đã có phản hồi: xem lại (+ nộp lại nếu bị từ chối, + chuyển sang đăng ký) ──
  if (response && !isSwitching) {
    return (
      <div className="max-w-[860px] space-y-4">
        <Breadcrumb />
        {justSubmitted && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-success-soft border border-success-line text-success-text text-sm">
            <Check size={16} className="flex-shrink-0 mt-0.5" />
            {response.choice === 'register'
              ? (response.superseded ? 'Đã chuyển sang đăng ký khám sức khỏe tại trường.' : 'Đã ghi nhận đăng ký khám sức khỏe.')
              : 'Đã ghi nhận kết quả khám và minh chứng.'}
          </div>
        )}
        {state.exam_ticket && <ExamTicket ticket={state.exam_ticket} />}
        <div className={ui.card}>
          {header}
          <div className="px-6 py-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[0.75rem] font-medium text-muted">Phản hồi đã gửi</div>
                <div className="text-sm font-semibold text-ink mt-0.5">
                  {response.choice === 'register'
                    ? 'Chưa khám — đăng ký khám tập trung tại trường'
                    : response.choice === 'other'
                      ? 'Dành cho đối tượng khác — sinh viên ngoại tỉnh chưa đăng ký tạm trú tại TP.HCM'
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
              {response.exam_slot && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Ngày và ca khám</span>
                  <span className={ui.dtValue}>{response.exam_slot_label}</span>
                </div>
              )}
              {response.superseded && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Khai báo đã khám trước đó</span>
                  <span className={ui.dtValue}>
                    {response.superseded.label}
                    {response.superseded.at ? ` lúc ${fmtDateTime(response.superseded.at)}` : ''}
                  </span>
                </div>
              )}
              {response.data_consent_at && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Cam kết, đồng ý cung cấp thông tin</span>
                  <span className={ui.dtValue}>{fmtDateTime(response.data_consent_at)}</span>
                </div>
              )}
              {response.reviewed_at && (
                <div className={ui.dtRow}>
                  <span className={ui.dtLabel}>Thời điểm xử lý</span>
                  <span className={ui.dtValue}>{fmtDateTime(response.reviewed_at)}</span>
                </div>
              )}
            </div>

            <RejectionNotice
              rejected={response.status === 'rejected'}
              eyebrow="Hồ sơ bị từ chối"
              noteLabel="Ghi chú của Phòng Công tác Sinh viên"
              note={response.review_note}
            />

            {response.choice === 'register' && <PackageInfo state={state} />}

            {response.choice !== 'register' && <ResultSummary response={response} />}

            {response.choice !== 'register' && (
              <div>
                <div className="text-[0.82rem] font-medium text-ink mb-2">Minh chứng đã nộp</div>
                <EvidenceThumbs response={response} />
              </div>
            )}

            {state.can_resubmit && (
              <div className="flex justify-end pt-4 border-t border-line2">
                <button type="button" className={ui.btnPrimary} onClick={() => setResubmitting(true)}>
                  <PencilLine size={15} /> Sửa kết quả và nộp lại minh chứng
                </button>
              </div>
            )}

            {state.can_switch_to_register && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-line2">
                <p className="text-[0.82rem] text-muted max-w-[520px]">
                  Chưa khám theo chương trình của Thành phố? Sinh viên có thể chuyển sang đăng ký khám
                  sức khỏe tập trung tại trường.
                </p>
                <button type="button" className={ui.btnGhost} onClick={startSwitch}>
                  <Repeat size={15} /> Chuyển sang đăng ký khám tại trường
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Đợt đang mở, chưa trả lời ──
  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSlotError(''); draft.setFieldErrors({});
    if (declarationLocked && state?.cccd_missing) {
      setError('Bổ sung số CCCD ở phần 1 trước khi gửi đăng ký.');
      return;
    }
    if (!declarationLocked) {
      const local = draft.validate({ requireCccd: true });
      if (Object.keys(local).length) {
        draft.setFieldErrors(local);
        setError('Vui lòng kiểm tra lại các ô được đánh dấu ở phần 1.');
        return;
      }
    }
    if (!eligible) { setError('Phần đăng ký khám chưa được mở.'); return; }
    if (state?.exam_slots && !examSlot) {
      setSlotError('Chưa chọn ca khám.');
      setError('Vui lòng chọn ngày và ca khám.');
      return;
    }
    if (!consent) { setError('Vui lòng tích xác nhận đồng ý tham gia khám sức khỏe tập trung.'); return; }
    if (!dataConsent) { setError('Vui lòng tích xác nhận cam kết và đồng ý cung cấp thông tin.'); return; }
    setSaving(true);
    try {
      setState(await api.healthCheck.register({
        declaration: declarationLocked ? undefined : draft.payload({ requireCccd: true }),
        consent: true,
        data_consent: true,
        exam_slot: state?.exam_slots ? examSlot : undefined,
        switch_from_examined: isSwitching || undefined,
      }));
      setSwitching(false);
      setJustSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.data?.errors) {
        draft.setFieldErrors(err.data.errors as Record<string, string>);
        const slotMsg = (err.data.errors as Record<string, string>).exam_slot;
        if (slotMsg) {
          // Ca vừa đầy / vừa qua giờ: tải lại lịch để SV thấy tình trạng mới rồi chọn ca khác.
          setSlotError(slotMsg); setExamSlot('');
          api.healthCheck.state().then(setState).catch(() => {});
        }
      }
      setError(err instanceof ApiError ? err.message : 'Không gửi được đăng ký.');
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-[860px] space-y-4">
      <Breadcrumb />

      <div className={ui.card}>
        {header}
        {isSwitching ? (
          <div className="px-6 py-5">
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-line border-l-[3px] border-l-[#d97706] bg-white px-4 py-3.5">
              <Repeat size={18} className="text-[#d97706] flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink">
                <div className="font-semibold">Chuyển sang đăng ký khám sức khỏe tại trường</div>
                <p className="mt-1">
                  Khai báo đã khám gửi lúc {fmtDateTime(response!.submitted_at)} sẽ <b>không còn được dùng</b>.
                  Thông tin đã khai vẫn được Nhà trường lưu lại. Sau khi chuyển, sinh viên không quay lại
                  khai báo đã khám được nữa.
                </p>
                <button type="button" className={cn(ui.btnGhost, 'mt-2')} onClick={cancelSwitch}>
                  Giữ khai báo đã khám
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <p className="text-[0.9rem] font-semibold text-ink mb-3">
              Sinh viên đã khám sức khỏe định kỳ theo kế hoạch của Ủy ban Nhân dân Thành phố
              Hồ Chí Minh hay chưa?<span className="text-red-500"> *</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <OptionTile option={round.options.examined} active={choice === 'examined'} title="Đã tham khám sức khoẻ"
                          desc="Khai kết quả khám theo phiếu và nộp ảnh minh chứng"
                          onClick={() => { setChoice('examined'); setError(''); }} />
              <OptionTile option={round.options.register} active={choice === 'register'} title="Chưa tham gia khám sức khoẻ"
                          desc="Đăng ký khám sức khỏe tập trung tại trường"
                          onClick={() => { setChoice('register'); setError(''); }} />
              <OptionTile option={round.options.other} active={choice === 'other'} title="Dành cho đối tượng khác"
                          desc="Sinh viên ngoại tỉnh chưa đăng ký tạm trú tại TP. Hồ Chí Minh — khai kết quả khám và nộp ảnh minh chứng"
                          onClick={() => { setChoice('other'); setError(''); }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Nhánh "Đã khám rồi" ── */}
      {choice === 'examined' && !isSwitching && state.can_submit_examined && (
        <ExaminedWizard key="examined" state={state} provinces={provinces} onDone={done} onStateChange={setState} />
      )}

      {/* ── Luồng "Dành cho đối tượng khác": cùng form 5 bước, thời hạn/công tắc riêng ── */}
      {choice === 'other' && !isSwitching && state.can_submit_other && (
        <ExaminedWizard key="other" choice="other" state={state} provinces={provinces}
                        onDone={done} onStateChange={setState} />
      )}

      {/* ── Nhánh "Chưa khám": phần 1 khai báo + phần 2 đăng ký ── */}
      {choice === 'register' && (state.can_submit_register || isSwitching) && (
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
                {declarationLocked && state.cccd_missing && (
                  <CccdForm onSaved={(next) => { setState(next); setError(''); }} />
                )}
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

              {/* Hiện cả khi phần 2 đang khóa — SV ngoài TP.HCM biết vì sao không đăng ký được. */}
              <div className="px-6 pt-5">
                <EligibilityInfo state={state} />
              </div>

              {!eligible ? (
                <div className="px-6 py-5">
                  <div role="alert" className="flex items-start gap-3 rounded-lg border border-line border-l-[3px] border-l-[#d97706] bg-white px-4 py-3.5">
                    <AlertTriangle size={18} className="text-[#d97706] flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-ink">
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
                  {state.exam_slots && (
                    <SlotPicker options={state.exam_slots} value={examSlot} error={slotError}
                                onChange={(key) => { setExamSlot(key); setSlotError(''); }} />
                  )}
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
                  <ConsentBox checked={dataConsent} onChange={setDataConsent}
                              text={state.data_consent_text.register} />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-line2">
                {isSwitching
                  ? <button type="button" className={ui.btnGhost} onClick={cancelSwitch}>Hủy</button>
                  : <Link href="/dashboard" className={ui.btnGhost}>Hủy</Link>}
                <button type="submit" disabled={saving || !eligible || !consent || !dataConsent || (!!state.exam_slots && !examSlot)} className={ui.btnPrimary}>
                  {saving ? <><Loader2 size={15} className="animate-spin" /> Đang gửi…</>
                          : <><ClipboardCheck size={15} /> {isSwitching ? 'Chuyển sang đăng ký khám' : 'Gửi đăng ký khám'}</>}
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

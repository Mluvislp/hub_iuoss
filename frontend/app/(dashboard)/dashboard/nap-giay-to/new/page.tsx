'use client';

/**
 * Nạp giấy tờ trực tiếp — form tạo mới, và sửa lại khi Phòng CTSV chuyển "Chờ bổ sung" (`?edit=<id>`).
 *
 * Sinh viên xác nhận thông tin cơ bản (ngày sinh + CCCD xin sửa được — chuyên viên duyệt như yêu cầu
 * giấy tờ), ghi tên loại giấy tờ cần xét, tải lên tối đa 10 ảnh / PDF và tích cam đoan.
 * Backend: core/direct_submissions.py (gửi multipart).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowLeft, Check, FileUp, Info, Loader2, MessageSquareWarning, Minus, Plus,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { ui, notice, noticeIcon } from '@/lib/ui';
import { ReadonlyField, EditableField } from '@/components/editable-field';
import { ConsentGate, CONSENT_REQUIRED_MSG, SubmissionConsent } from '@/components/request-consent';
import { SubmissionFileGrid, SubmissionUploader } from '@/components/submission-files';
import { validateCccd, validateDob, validateIssueDate, isValidDob, isValidIssueDate } from '@/lib/form-validators';
import type { SubmissionDetail, SubmissionFormData } from '@/lib/types';

type FieldKey = 'dob' | 'citizen_id' | 'citizen_id_issue_date';
type ErrKey = FieldKey | 'document_name' | 'copies' | 'phone' | 'files' | 'note' | 'consent';

const PHONE_RE = /^0(3|5|7|8|9)\d{8}$/;
function normalizePhone(v: string): string {
  let t = v.replace(/[\s.\-()]/g, '');
  if (t.startsWith('+84')) t = '0' + t.slice(3);
  else if (t.startsWith('84') && t.length === 11) t = '0' + t.slice(2);
  return t;
}

export default function SubmissionFormPage() {
  const [form, setForm] = useState<SubmissionFormData | null>(null);
  const [loadError, setLoadError] = useState('');

  // Sửa lại yêu cầu "Chờ bổ sung" — đọc ?edit=<id> bằng window.location (khỏi bọc Suspense).
  const [editId, setEditId] = useState<number | null>(null);
  const [editing, setEditing] = useState<SubmissionDetail | null>(null);
  const [editError, setEditError] = useState('');

  const [values, setValues] = useState<Record<FieldKey, string>>({ dob: '', citizen_id: '', citizen_id_issue_date: '' });
  const [openFields, setOpenFields] = useState<Record<FieldKey, boolean>>({ dob: false, citizen_id: false, citizen_id_issue_date: false });
  const [documentName, setDocumentName] = useState('');
  const [copies, setCopies] = useState(1);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ id: number; code: string } | null>(null);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<Partial<Record<ErrKey, string>>>({});
  const editApplied = useRef(false);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('edit');
    const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    if (id !== null) {
      setEditId(id);
      api.submissions.detail(id)
        .then((d) => {
          if (!d.student_can_edit) setEditError('Yêu cầu này không còn ở trạng thái “Chờ bổ sung thông tin” nên không sửa được.');
          else setEditing(d);
        })
        .catch((e) => setEditError(e instanceof ApiError ? e.message : 'Không tải được yêu cầu cần sửa.'));
    }
    api.submissions.form()
      .then((data) => {
        const p = data.prefill;
        setForm(data);
        setValues({ dob: p.dob, citizen_id: p.citizen_id, citizen_id_issue_date: p.citizen_id_issue_date });
        // Ô trống / sai thì mở sẵn (cùng luật các form giấy tờ).
        setOpenFields({
          dob: !isValidDob(p.dob),
          citizen_id: !p.cccd_valid,
          citizen_id_issue_date: !p.cccd_valid || !isValidIssueDate(p.citizen_id_issue_date),
        });
        setPhone(p.phone);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Không tải được thông tin sinh viên.'));
  }, []);

  // Điền lại từ yêu cầu cũ một lần, khi cả form lẫn yêu cầu đã nạp.
  useEffect(() => {
    if (!form || !editing || editApplied.current) return;
    editApplied.current = true;
    setDocumentName(editing.document_name);
    setCopies(editing.copies);
    setPhone(editing.contact_phone || form.prefill.phone);
    setNote(editing.note ?? '');
    const ed = editing.payload.editable ?? {};
    (Object.keys(values) as FieldKey[]).forEach((k) => {
      const info = ed[k];
      // Ô SV đã xin sửa mà chưa bị từ chối ⇒ điền lại giá trị đề nghị và mở ô.
      if (info?.changed && info.review !== 'rejected') {
        setValues((s) => ({ ...s, [k]: info.proposed }));
        setOpenFields((s) => ({ ...s, [k]: true }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, editing]);

  const isEdit = editId !== null;

  function setValue(k: FieldKey, v: string) {
    setValues((s) => ({ ...s, [k]: v }));
    setErrs((e) => ({ ...e, [k]: undefined }));
  }

  function toggleRemove(id: number) {
    setRemoved((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setErrs((e) => ({ ...e, files: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const p = form.prefill;
    const next: Partial<Record<ErrKey, string>> = {};
    if (!documentName.trim()) next.document_name = 'Vui lòng nhập tên loại giấy tờ cần xét.';
    if (!PHONE_RE.test(normalizePhone(phone))) next.phone = 'Số điện thoại cần 10 chữ số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.';
    if (values.dob.trim() !== p.dob.trim()) { const m = validateDob(values.dob); if (m) next.dob = m; }
    const ce = validateCccd(values.citizen_id, p.citizen_id); if (ce) next.citizen_id = ce;
    const cidChanged = values.citizen_id.trim() !== p.citizen_id.trim();
    const issueChanged = values.citizen_id_issue_date.trim() !== p.citizen_id_issue_date.trim();
    if (cidChanged || issueChanged || !isValidIssueDate(p.citizen_id_issue_date)) {
      const ie = validateIssueDate(values.citizen_id_issue_date); if (ie) next.citizen_id_issue_date = ie;
    }
    const keep = (editing?.files ?? []).filter((f) => !removed.has(f.id)).length;
    if (keep + files.length === 0) next.files = 'Vui lòng tải lên ít nhất một ảnh chụp hoặc bản scan giấy tờ.';
    if (!confirmed) next.consent = CONSENT_REQUIRED_MSG;
    setErrs(next);
    if (Object.keys(next).length) {
      setError(next.consent && Object.keys(next).length === 1 ? CONSENT_REQUIRED_MSG : 'Vui lòng kiểm tra lại các trường được đánh dấu.');
      return;
    }
    setError('');

    const body = new FormData();
    body.append('document_name', documentName.trim());
    body.append('copies', String(copies));
    body.append('phone', normalizePhone(phone));
    body.append('note', note.trim());
    body.append('dob', values.dob.trim());
    body.append('citizen_id', values.citizen_id.trim());
    body.append('citizen_id_issue_date', values.citizen_id_issue_date.trim());
    body.append('consent', '1');
    files.forEach((f) => body.append('files', f, f.name));
    removed.forEach((id) => body.append('remove_file_ids', String(id)));

    setLoading(true);
    try {
      if (isEdit && editing) {
        const d = await api.submissions.update(editing.id, body);
        setDone({ id: d.id, code: d.code });
      } else {
        setDone(await api.submissions.create(body));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrs = (err.data.errors ?? {}) as Partial<Record<ErrKey, string>>;
        setErrs(fieldErrs);
        setError(err.status === 413 ? 'Tổng dung lượng file quá lớn. Bớt file hoặc giảm dung lượng rồi gửi lại.' : err.message);
      } else {
        setError('Gửi yêu cầu thất bại. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadError || editError) {
    return (
      <div className="max-w-[760px] space-y-4">
        <Link href="/dashboard/nap-giay-to" className={ui.btnSecondary}><ArrowLeft size={15} /> Nạp giấy tờ trực tiếp</Link>
        <div className={cn(notice.base, notice.error)}><AlertCircle className={noticeIcon.error} /><p>{loadError || editError}</p></div>
      </div>
    );
  }
  if (!form || (isEdit && !editing)) {
    return <div className="flex items-center justify-center py-20 text-muted"><Loader2 size={22} className="animate-spin mr-2" /> Đang tải…</div>;
  }

  if (done) {
    return (
      <div className="max-w-[760px]">
        <div className={cn(ui.card, 'p-8 text-center')}>
          <div className="w-11 h-11 rounded-full bg-success-soft border border-success-line flex items-center justify-center mx-auto mb-4">
            <Check size={22} className="text-success-text" />
          </div>
          <h2 className="text-lg font-semibold text-ink">{isEdit ? 'Đã cập nhật yêu cầu' : 'Đã gửi yêu cầu'}</h2>
          <p className="text-sm text-muted mt-2">
            Mã yêu cầu <span className="font-mono font-semibold text-ink">{done.code}</span>. Phòng Công tác Sinh viên sẽ
            tiếp nhận và phản hồi trên hệ thống.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href={`/dashboard/nap-giay-to/${done.id}`} className={ui.btnPrimary}>Xem yêu cầu</Link>
            <Link href="/dashboard/nap-giay-to" className={ui.btnOutline}>Danh sách đã nạp</Link>
          </div>
        </div>
      </div>
    );
  }

  const p = form.prefill;
  const lim = form.limits;
  const originals: Record<FieldKey, string> = { dob: p.dob, citizen_id: p.citizen_id, citizen_id_issue_date: p.citizen_id_issue_date };
  const lockable: Record<FieldKey, boolean> = {
    dob: isValidDob(p.dob),
    citizen_id: p.cccd_valid,
    citizen_id_issue_date: p.cccd_valid && isValidIssueDate(p.citizen_id_issue_date),
  };
  const editCount = (Object.keys(originals) as FieldKey[]).filter((k) => values[k].trim() !== originals[k].trim()).length;
  const keptFiles = (editing?.files ?? []).filter((f) => !removed.has(f.id));
  const lastStaffAsk = editing ? [...editing.comments].reverse().find((c) => c.event === 'awaiting_info') : undefined;

  return (
    <div className="max-w-[760px] space-y-4">
      <nav className="flex items-center gap-1.5 text-[0.82rem] text-muted">
        <Link href="/dashboard" className="hover:text-ink">Bảng thông tin</Link>
        <span className="text-slate-400">/</span>
        <Link href="/dashboard/nap-giay-to" className="hover:text-ink">Nạp giấy tờ trực tiếp</Link>
        <span className="text-slate-400">/</span>
        <span className="text-ink font-medium">{isEdit ? `Sửa ${editing?.code}` : 'Nạp giấy tờ mới'}</span>
      </nav>

      {isEdit && editing && (
        <div className={cn(notice.base, notice.warning)}>
          <MessageSquareWarning className={noticeIcon.warning} />
          <div className="min-w-0">
            <p className="font-semibold">Sửa yêu cầu {editing.code} theo nội dung Phòng CTSV yêu cầu bổ sung</p>
            {lastStaffAsk && (
              <p className="mt-1 whitespace-pre-wrap text-[0.84rem] text-slate-700">
                “{lastStaffAsk.body}” <span className="text-muted">— {formatDateTime(lastStaffAsk.created_at)}</span>
              </p>
            )}
            <p className="mt-1 text-[0.8rem] text-muted">Gửi lại xong, yêu cầu tự chuyển về “Chờ xử lý”.</p>
          </div>
        </div>
      )}

      <div className={ui.card}>
        <div className="px-6 py-5 border-b border-line">
          <h1 className="flex items-center gap-2 text-[1.05rem] font-semibold text-ink">
            <FileUp size={17} className="text-slate-500" />
            Nạp giấy tờ trực tiếp
          </h1>
          <p className="text-sm text-muted mt-1">
            Khai thông tin, ghi tên giấy tờ cần Phòng Công tác Sinh viên xét và tải lên ảnh chụp hoặc bản scan giấy tờ.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6" noValidate>
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-danger-soft border border-danger-line text-danger-text text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Thông tin sinh viên</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <ReadonlyField label="Họ và tên" value={p.student_name} />
              <ReadonlyField label="Mã số sinh viên" value={p.student_id} />
              <ReadonlyField label="Khoa" value={p.department} />
              <ReadonlyField label="Ngành" value={p.major} />
              <ReadonlyField label="Mã lớp" value={p.class_code} />
              <ReadonlyField label="Trạng thái" value={p.cur_status_vi} />
            </div>
          </div>

          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Ngày sinh &amp; căn cước công dân</h2>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-4">
              <EditableField
                label="Ngày sinh" kind="date"
                value={values.dob} original={originals.dob} open={openFields.dob} lockable={lockable.dob}
                error={errs.dob} maxLength={10}
                onChange={(v) => setValue('dob', v)}
                onOpen={() => setOpenFields((s) => ({ ...s, dob: true }))}
                onCancel={() => { setValue('dob', originals.dob); setOpenFields((s) => ({ ...s, dob: false })); }}
              />
              <div className="hidden sm:block" />
              <EditableField
                label="Số CCCD"
                value={values.citizen_id} original={originals.citizen_id} open={openFields.citizen_id} lockable={lockable.citizen_id}
                error={errs.citizen_id} maxLength={12} inputMode="numeric" placeholder="12 chữ số"
                onChange={(v) => setValue('citizen_id', v)}
                onOpen={() => setOpenFields((s) => ({ ...s, citizen_id: true }))}
                onCancel={() => { setValue('citizen_id', originals.citizen_id); setOpenFields((s) => ({ ...s, citizen_id: false })); }}
              />
              <EditableField
                label="Ngày cấp" kind="date"
                value={values.citizen_id_issue_date} original={originals.citizen_id_issue_date}
                open={openFields.citizen_id_issue_date} lockable={lockable.citizen_id_issue_date}
                error={errs.citizen_id_issue_date} maxLength={10}
                onChange={(v) => setValue('citizen_id_issue_date', v)}
                onOpen={() => setOpenFields((s) => ({ ...s, citizen_id_issue_date: true }))}
                onCancel={() => { setValue('citizen_id_issue_date', originals.citizen_id_issue_date); setOpenFields((s) => ({ ...s, citizen_id_issue_date: false })); }}
              />
            </div>
            <p className="mt-2 text-[0.78rem] text-muted">
              Thông tin chỉnh sửa được Phòng Công tác Sinh viên duyệt trước khi cập nhật vào hồ sơ.
            </p>
          </div>

          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">Giấy tờ cần xét</h2>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div>
                <label htmlFor="document_name" className={ui.fieldLabel}>Tên loại giấy tờ <span className="text-red-500">*</span></label>
                <input
                  id="document_name" type="text" value={documentName} maxLength={lim.document_name_max}
                  onChange={(e) => { setDocumentName(e.target.value); setErrs((x) => ({ ...x, document_name: undefined })); }}
                  placeholder="VD: Đơn xin xác nhận vay vốn của ngân hàng ABC"
                  className={cn(ui.input, errs.document_name && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
                />
                {errs.document_name
                  ? <p className="mt-1 text-[0.75rem] text-danger-text">{errs.document_name}</p>
                  : <p className="mt-1 text-[0.75rem] text-muted">Ghi đúng tên trên giấy tờ (mẫu đơn, giấy xác nhận…) cần Phòng CTSV xét, ký hoặc đóng dấu.</p>}
              </div>
              <div>
                <label className={ui.fieldLabel}>Số bản <span className="text-red-500">*</span></label>
                <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-line bg-white">
                  <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))} disabled={copies <= 1}
                          className="px-3 text-slate-500 hover:bg-slate-50 disabled:opacity-40" aria-label="Bớt một bản"><Minus size={14} /></button>
                  <span className="flex flex-1 items-center justify-center border-x border-line text-sm font-semibold text-ink">{copies}</span>
                  <button type="button" onClick={() => setCopies((c) => Math.min(lim.copies_max, c + 1))} disabled={copies >= lim.copies_max}
                          className="px-3 text-slate-500 hover:bg-slate-50 disabled:opacity-40" aria-label="Thêm một bản"><Plus size={14} /></button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-[0.82rem] font-semibold text-muted mb-2.5">
              Ảnh chụp / bản scan giấy tờ <span className="text-red-500">*</span>
            </h2>
            {isEdit && editing && editing.files.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-[0.8rem] text-muted">File đã nạp — bấm “Gỡ” với file cần thay, rồi tải file mới bên dưới.</p>
                <SubmissionFileGrid submissionId={editing.id} files={editing.files} removable removed={removed} onToggleRemove={toggleRemove} />
              </div>
            )}
            <SubmissionUploader
              files={files} limits={lim} error={errs.files}
              existingCount={keptFiles.length} existingBytes={keptFiles.reduce((s, f) => s + f.size, 0)}
              onChange={(f) => { setFiles(f); setErrs((x) => ({ ...x, files: undefined })); }}
              disabled={loading}
            />
            <p className="mt-2 text-[0.75rem] text-muted">
              Chụp rõ, đủ các trang và đủ bốn góc giấy; mỗi trang một ảnh hoặc gộp thành một file PDF.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className={ui.fieldLabel}>Số điện thoại liên hệ <span className="text-red-500">*</span></label>
              <input
                id="phone" type="tel" inputMode="tel" value={phone} maxLength={15}
                onChange={(e) => { setPhone(e.target.value); setErrs((x) => ({ ...x, phone: undefined })); }}
                className={cn(ui.input, errs.phone && 'border-danger-line focus:border-danger-line focus:ring-red-100')}
              />
              {errs.phone
                ? <p className="mt-1 text-[0.75rem] text-danger-text">{errs.phone}</p>
                : <p className="mt-1 text-[0.75rem] text-muted">Chỉ dùng để liên hệ về yêu cầu này, không thay đổi hồ sơ.</p>}
            </div>
            <ReadonlyField label="Email nhận thông báo" value={p.email} />
          </div>

          <div>
            <label htmlFor="note" className={ui.fieldLabel}>Ghi chú thêm <span className="text-muted font-normal">(không bắt buộc)</span></label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={lim.note_max} className={ui.textarea} />
            <ul className="mt-1.5 space-y-0.5 text-[0.75rem] text-muted">
              <li>• Nội dung cần Phòng CTSV xác nhận, nơi nộp giấy tờ hoặc thời hạn cần nhận lại.</li>
              <li>• Thông tin sinh viên có sai sót: ghi rõ thông tin sai và thông tin đúng.</li>
            </ul>
          </div>

          <SubmissionConsent
            checked={confirmed} editCount={editCount} error={!!errs.consent}
            onChange={(v) => { setConfirmed(v); if (v) { setErrs((x) => ({ ...x, consent: undefined })); if (error === CONSENT_REQUIRED_MSG) setError(''); } }}
          />

          <div className={ui.formFooter}>
            <Link href={isEdit && editing ? `/dashboard/nap-giay-to/${editing.id}` : '/dashboard/nap-giay-to'} className={cn(ui.btnGhost, ui.formFooterBtn)}>
              <ArrowLeft size={15} /> Quay lại
            </Link>
            <ConsentGate checked={confirmed} className={ui.formFooterBtn}>
              <button type="submit" disabled={loading} className={cn(ui.btnPrimary, ui.formFooterBtn)}>
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'Đang tải lên…' : isEdit ? 'Cập nhật yêu cầu' : 'Gửi yêu cầu'}
              </button>
            </ConsentGate>
          </div>
        </form>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-50 border-l-2 border-primary">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[0.85rem] text-slate-600 leading-relaxed">
          Nộp bản giấy tại Phòng Công tác Sinh viên (O1.105). Khi hoàn thành, Phòng CTSV gửi email kèm
          <strong className="text-ink font-medium"> mã trả hồ sơ</strong> — xuất trình mã này khi nhận lại giấy.
        </p>
      </div>
    </div>
  );
}

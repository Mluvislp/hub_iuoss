const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const filename = path.resolve(__dirname, '../components/submitted-insurance-info.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', code)((name) => {
  if (name === '@/lib/api') return { api: { insuranceRegistration: { evidence: async () => new Blob() } } };
  if (name === '@/lib/ui') return {
    ui: { card:'card', cardHeader:'card-header', sectionTitle:'section-title', btnSecondary:'btn-secondary', btnGhost:'btn-ghost', dtRow:'dt-row', dtLabel:'dt-label', dtValue:'dt-value' },
    badge: { base:'badge', success:'success', neutral:'neutral' },
    accentIcon: { primary:'primary' },
  };
  if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
  if (name === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
  return require(name);
}, mod, mod.exports);
const { SubmittedInsuranceInfo } = mod.exports;
const current = {
  id: 123, row_version: 4, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
  prefill: { full_name: 'Tên đã chỉnh sửa', citizen_id: '012345678901', permanent_street: 'Địa chỉ đã nộp', hospital_code: '79001' },
  display: { hospital_code: 'Bệnh viện Đại học Y Dược' },
  window: { can_edit: true, end_date: '2026-10-01T00:00:00Z' },
};
const render = (data, props = {}) => renderToStaticMarkup(React.createElement(SubmittedInsuranceInfo, { data, ...props }));
let html = render(current);
assert.ok(html.includes('Tên đã chỉnh sửa') && html.includes('012345678901') && html.includes('Địa chỉ đã nộp'));
assert.ok(html.includes('Bệnh viện Đại học Y Dược') && !html.includes('79001'));
assert.ok(html.includes('/dang-ky?edit=123'));
html = render({ ...current, window: { ...current.window, can_edit: false } });
assert.ok(!html.includes('?edit=123'));
assert.ok(html.includes('Hạn kết thúc:'));
html = render({ ...current, window: undefined });
assert.ok(html.includes('Hạn kết thúc:') && html.includes('Tên đã chỉnh sửa'));
assert.ok(!html.includes('?edit=123'));
html = render({ ...current, can_edit: true, window: { can_edit: false } }, { external: true });
assert.ok(html.includes('/khai-noi-khac?edit=123'));
html = render(current, { showEdit: false });
assert.ok(!html.includes('?edit=123'));
html = render({ ...current, can_edit: false, edited_at: '2026-09-20T03:04:05Z' });
assert.ok(html.includes('không thể chỉnh sửa thêm') && !html.includes('?edit=123'));
html = render({ ...current, history: [{ event_type:'RESUBMITTED', created_at:current.updated_at,
  payload:{previous_rejection:'Ảnh chưa rõ', changes:{full_name:{before:'Cũ', after:'Mới'}}} }] });
assert.ok(html.includes('Ảnh chưa rõ') && html.includes('Cũ') && html.includes('Mới'));
console.log('PASS: current values, legacy view, open/closed edit links, resubmission, edit-mode preview, audit history (6 cases)');

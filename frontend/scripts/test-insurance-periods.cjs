const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const filename = path.resolve(__dirname, '../lib/insurance-periods.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = new Module(filename, module);
mod._compile(compiled, filename);
const visible = mod.exports.getVisibleInsurancePeriods;
const period = (registration_period, registration_year, status, start_date = '2026-09-01') => ({
  id: registration_period.toLowerCase(), registration_period, registration_year, status,
  start_date, is_active: status === 'open',
});
const ids = periods => visible(periods).map(p => p.registration_year + p.registration_period);
assert.deepEqual(ids([period('MAIN', 2027, 'open'), period('Q2', 2027, 'upcoming'), period('Q4', 2026, 'expired')]), ['2027MAIN', '2027Q2']);
assert.deepEqual(ids([period('Q2', 2027, 'upcoming'), period('MAIN', 2027, 'open')]), ['2027MAIN', '2027Q2']);
assert.deepEqual(ids([period('Q3', 2027, 'upcoming'), period('MAIN', 2027, 'expired'), period('Q2', 2027, 'expired')]), ['2027Q2', '2027Q3']);
assert.deepEqual(ids([period('MAIN', 2027, 'upcoming'), period('Q4', 2026, 'expired', '2026-09-15')]), ['2026Q4', '2027MAIN']);
assert.deepEqual(ids([period('Q3', 2026, 'expired'), period('Q4', 2026, 'expired'), period('MAIN', 2026, 'expired')]), ['2026Q4', '2026MAIN']);
assert.deepEqual(ids([period('MAIN', 2027, 'upcoming'), period('Q2', 2027, 'upcoming')]), ['2027MAIN', '2027Q2']);
assert.deepEqual(ids([period('MAIN', 2027, 'open')]), ['2027MAIN']);
assert.deepEqual(ids([period('Q4', 2026, 'expired'), period('Q3', 2026, 'upcoming'), period('Q2', 2026, 'open')]), ['2026Q2', '2026Q3']);
assert.deepEqual(ids([]), []);
console.log('9 insurance period scenarios passed');

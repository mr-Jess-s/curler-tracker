import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/bootFromSavedState\(\);\s*loadArchiveHome\(\);\s*$/, '');
const element = () => ({
  value: '', textContent: '', innerHTML: '', disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, appendChild() {},
  querySelector() { return null; }
});
const elements = new Map();
const context = vm.createContext({
  console, URL, URLSearchParams, AbortController, Intl, Date, Map, Set, Promise, queueMicrotask,
  clearTimeout() {}, setTimeout() { return 1; },
  fetch() { throw new Error('Network is not permitted in deterministic name QA'); },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  navigator: {}, history: { replaceState() {}, pushState() {} },
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, addEventListener() {}, createElement: element },
  window: { location: { search: '', href: 'http://localhost/' }, addEventListener() {}, setTimeout() { return 1; }, clearTimeout() {} }
});
vm.runInContext(appSource, context);
const timings = [];
const resolve = (catalog, query) => {
  const started = performance.now();
  const result = vm.runInContext('findNameChoices(globalThis.qaCatalog, globalThis.qaQuery)', Object.assign(context, { qaCatalog: catalog, qaQuery: query }));
  timings.push(performance.now() - started);
  return result;
};

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'curler-name-catalog.json'), 'utf8'));
const selected = JSON.parse(fs.readFileSync(path.join(root, 'release-evidence', '2026-10-16', 'field-audit', 'selected-curlers.json'), 'utf8')).sample;
const severe = JSON.parse(fs.readFileSync(path.join(root, 'release-evidence', '2026-10-16', 'typo-audit', 'query-manifest.json'), 'utf8')).queries;

const exactResults = selected.map(row => {
  const result = resolve(catalog, row.name);
  const profile = row.source_curler_id == null
    ? result.exact
    : result.exact?.profiles?.find(item => item.source_subdomain === row.association && String(item.source_curler_id) === String(row.source_curler_id));
  return { name: row.name, association: row.association, source_curler_id: row.source_curler_id, pass: !!profile };
});
const severeResults = severe.filter(row => row.changed).map(row => {
  const result = resolve(catalog, row.query);
  const names = result.suggestions.map(item => item.name);
  return { name: row.name, query: row.query, suggestions: names, pass: names.includes(row.name) };
});

function realisticVariants(name) {
  const chars = Array.from(name);
  const letterIndexes = chars.map((char, index) => /[A-Za-z]/.test(char) ? index : -1).filter(index => index >= 0);
  const middle = letterIndexes[Math.floor(letterIndexes.length / 2)];
  const swap = letterIndexes.find(index => index + 1 < chars.length && /[A-Za-z]/.test(chars[index + 1]));
  const variants = [];
  if (middle !== undefined) variants.push({ kind: 'deletion', query: chars.filter((_, index) => index !== middle).join('') });
  if (middle !== undefined) variants.push({ kind: 'substitution', query: chars.map((char, index) => index === middle ? (char.toLowerCase() === 'a' ? 'e' : 'a') : char).join('') });
  if (middle !== undefined) variants.push({ kind: 'insertion', query: chars.slice(0, middle).join('') + 'x' + chars.slice(middle).join('') });
  if (swap !== undefined) {
    const copy = chars.slice();
    [copy[swap], copy[swap + 1]] = [copy[swap + 1], copy[swap]];
    variants.push({ kind: 'transposition', query: copy.join('') });
  }
  return variants;
}

const realisticResults = selected.flatMap(row => realisticVariants(row.name).map(variant => {
  const result = resolve(catalog, variant.query);
  const names = result.exact ? [result.exact.name] : result.suggestions.map(item => item.name);
  return { name: row.name, ...variant, pass: names.includes(row.name) };
}));
const count = rows => rows.filter(row => row.pass).length;
const sortedTimings = timings.slice().sort((a, b) => a - b);
const percentile = value => Number(sortedTimings[Math.min(sortedTimings.length - 1, Math.ceil(sortedTimings.length * value) - 1)].toFixed(2));
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  app_version: vm.runInContext('APP_VERSION', context),
  catalog_names: catalog.name_count,
  resolution_performance_ms: { samples: timings.length, median: percentile(0.5), p95: percentile(0.95), max: percentile(1) },
  exact: { passed: count(exactResults), total: exactResults.length, results: exactResults },
  severe_typo: { passed: count(severeResults), total: severeResults.length, results: severeResults },
  realistic_typo: { passed: count(realisticResults), total: realisticResults.length, results: realisticResults }
};
const out = process.argv[2];
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ exact: report.exact, severe_typo: report.severe_typo, realistic_typo: report.realistic_typo, resolution_performance_ms: report.resolution_performance_ms }, (key, value) => key === 'results' ? undefined : value));
assert.equal(report.exact.passed, report.exact.total, 'Every reference identity must be present in its scoped source profile');
assert.ok(report.severe_typo.passed / report.severe_typo.total >= 0.90, 'Severe typo recovery must be at least 90%');
assert.ok(report.realistic_typo.passed / report.realistic_typo.total >= 0.98, 'Realistic typo recovery must be at least 98%');
assert.ok(report.resolution_performance_ms.p95 < 3000, 'Local identity resolution p95 must remain under three seconds');

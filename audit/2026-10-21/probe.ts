// SPDX-License-Identifier: GPL-3.0-or-later
// Review-only probes. No production code is modified.
import fs from 'node:fs';
import vm from 'node:vm';
import { assessment } from '../../src/core/presentation';
import { morphologyAlerts } from '../../src/core/alerts';
import { analyze } from '../../src/core/pipeline';
import { parsePdf, parsePdfText } from '../../src/core/pdf';
import { ecgClean, maximumFilter1d, sosFiltFilt, BUTTER_5_HIGHPASS_512_SOS } from '../../src/core/dsp';
import { renderDashboardSvg } from '../../src/render/svg';
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = await Promise.all(jobs.map(async (j: any) => {
  try {
    if (j.op === 'dsp') {
      const x = new Float64Array(j.v);
      return { clean: Array.from(ecgClean(x, j.fs)), highpass: Array.from(sosFiltFilt(BUTTER_5_HIGHPASS_512_SOS, x)), maximum: Array.from(maximumFilter1d(x, j.size || 4)) };
    }
    if (j.op === 'ui') {
      let script = fs.readFileSync(j.path, 'utf8');
      if (script.includes('<html')) script = fs.readFileSync(j.path.replace(/index\.html$/, 'app.js'),'utf8');
      let syntaxError = null;
      try { new vm.Script(script); } catch (e: any) { syntaxError = e.message; }
      // Evaluate renderResults alone so a separate page syntax failure cannot mask its logic.
      const render = script.slice(script.indexOf('function renderResults'), script.indexOf('// Viewport Controls'));
      const elements = new Map();
      const get = (id: string) => { if (!elements.has(id)) elements.set(id, { style: {}, innerText: '', innerHTML: '', className: '', scrollIntoView() {} }); return elements.get(id); };
      const ctx = vm.createContext({ document: { getElementById: get }, resetCanvasZoom() {}, escapeHtml: (x: string) => x });
      const helper = script.slice(script.indexOf('function applyEvaluation'), script.indexOf('async function downloadCsv'));
      vm.runInContext(render + helper, ctx);
      const base = analyze(await parsePdf(new Uint8Array(fs.readFileSync('test/fixtures/synthetic_demo.pdf')))).report;
      const cases = j.cases.map((data: any) => { const mo = {...base.morphology!,...data.morphology}; if (mo.qt_reliable === false) mo.t_amp_mv = 0.04; const decisions = morphologyAlerts(mo,data.rhythm?.hr_bpm ?? 72); const rep = {...base,...data,rhythm:{...base.rhythm,n_premature_same:0,n_premature_diff:0,n_odd:0,pauses:[],rr_alternation_start_s:[],...data.rhythm}, morphology:mo,morphology_alerts:{sex:'unknown',placement:'wrist',...decisions}}; data.assessment=assessment(rep); (ctx as any).renderResults(data); return { name: data.case, badge: get('status-badge').innerText, qtc: get('tag-qtc').innerText, pr: get('tag-pr').innerText, ectopic: get('tag-ectopic').innerText, rmssd: get('val-rmssd').innerText }; });
      return { syntaxError, cases };
    }
    const rec = j.path ? await parsePdf(new Uint8Array(fs.readFileSync(j.path))) : {
      ...parsePdfText(''), fs: j.fs, t: new Float64Array(j.t), v: new Float64Array(j.v),
      clip: new Uint8Array(j.v.length), rows: [], source: 'vector' as const, record_id: 'SYNTHETIC_AUDIT', notes: []
    };
    if (j.op === 'parse') return { samples: rec.t.length, start: rec.t[0], end: rec.t[rec.t.length-1], fs: rec.fs, watch: rec.watch, identity_present: { name: !!rec.identity.name, dob: !!rec.identity.dob } };
    const result = analyze(rec, j.exclude || [], j.sex || 'unknown', j.placement || 'wrist');
    return { report: result.report, samples: rec.t.length, end: rec.t[rec.t.length-1], svgNormalClaim: renderDashboardSvg(rec, result).includes('测量指标均在 AHA/ESC 正常生理范围内') };
  } catch(e: any) { return { error: e.message }; }
}));
process.stdout.write(JSON.stringify(results));

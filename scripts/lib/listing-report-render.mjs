// ============================================================
// A4 HTML for the daily 55-day and withdrawn reports (Studio Minimalist,
// black-and-white logo). Pure: groups in, HTML string out. Chrome prints it.
// See docs/plans/2026-11-23-1311-feat-daily-55day-withdrawn-reports-plan.html (U3).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOGO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'grants-logo-bw.svg'), 'utf8').replace(/<\?xml[^>]*\?>/, '');
const FIRST_SHEET_ROWS = 11, SHEET_ROWS = 16; // shortcut: fixed rows per sheet; two-line rows fit, very long addresses could crowd

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const spec = (r) => [r.bedrooms, r.bathrooms, r.car_spaces].map((v) => v ?? '–').join(' / ');

const KIND = {
  '55day': { title: '55 days, not sold', lead: 'Listings that reached 55 days on market since the last report.', dom: 'Days on market' },
  withdrawn: { title: 'Withdrawn listings', lead: 'Listings taken off the portals since the last report, with no recorded sale.', dom: 'Days at withdrawal' },
};

function rowHtml(r, k) {
  const cut = r.cut?.cuts ? `${r.cut.cuts} cut${r.cut.cuts > 1 ? 's' : ''}, ${r.cut.pct}%` : '–';
  return `<tr class="l"><td><b>${esc(r.raw_address)}</b><br><span class="m">${[r.property_type, spec(r), r.agency_name, r.agent_name].filter(Boolean).map(esc).join(' · ')}</span></td>`
    + `<td>${esc(r.display_price) || '–'}<br><span class="m">${cut}</span></td>`
    + `<td class="n">${r.daysOnMarket}${r.firstSeen ? '<br><span class="m">first seen</span>' : ''}</td>`
    + `<td>${r.listing_url ? `<a href="${esc(r.listing_url)}">View</a>` : ''}</td></tr>`;
}

/** @param {'55day'|'withdrawn'} kind @param {[string, object[]][]} groups @param {{date:string,total55?:number,feedIssues:string[],staleCount:number}} meta */
export function renderReport(kind, groups, meta) {
  const k = KIND[kind];
  const count = groups.reduce((n, [, rs]) => n + rs.length, 0);
  // Flatten into sheets: a suburb heading row, then its listings; split across sheets as needed.
  const items = groups.flatMap(([s, rs]) => [{ h: s, n: rs.length }, ...rs]);
  const sheets = [];
  for (let i = 0, cap = FIRST_SHEET_ROWS; i < items.length || !sheets.length; cap = SHEET_ROWS) { sheets.push(items.slice(i, i + cap)); i += cap; }
  const head = `<thead><tr><th>Property</th><th>Asking price</th><th class="n">${k.dom}</th><th></th></tr></thead>`;
  const table = (its) => its.length ? `<table>${head}<tbody>${its.map((it) => it.h ? `<tr class="s"><td colspan="4">${esc(it.h)} <span class="m">${it.n}</span></td></tr>` : rowHtml(it, kind)).join('')}</tbody></table>` : '';
  const banner = meta.feedIssues?.length ? `<div class="warn">Feed problem this morning: ${meta.feedIssues.map(esc).join(', ')}. This report may be incomplete.</div>` : '';
  const stats = kind === '55day'
    ? `<div class="st"><div><span class="v">${count}</span><span class="lab">New today</span></div><div><span class="v">${meta.total55 ?? '–'}</span><span class="lab">Active at 55+ days</span></div></div>`
    : `<div class="st"><div><span class="v">${count}</span><span class="lab">Withdrawn today</span></div></div>${meta.staleCount ? `<p class="m">${meta.staleCount} older listing${meta.staleCount > 1 ? 's' : ''} also closed after 21 days unseen (not listed).</p>` : ''}`;
  const n = sheets.length;
  const body = sheets.map((its, i) => `<section class="sheet"><div class="mast">${LOGO}<div class="meta">${esc(k.title)}<br>${esc(meta.date)} · Casey &amp; Cardinia</div></div>`
    + (i === 0 ? `<h1>${esc(k.title)}</h1><p>${k.lead}</p>${banner}${stats}${count ? '' : '<p class="none">None today.</p>'}` : '')
    + table(its) + `<div class="foot"><span>everypropertyAI · ${esc(k.title)}</span><span>${i + 1} / ${n}</span></div></section>`).join('');
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(k.title)} ${esc(meta.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Inter,sans-serif;color:#1a1c1c;font-size:9.5pt;line-height:1.45;background:#fff}
.sheet{width:210mm;height:297mm;padding:16mm 18mm;display:flex;flex-direction:column;overflow:hidden;page-break-after:always}.sheet:last-child{page-break-after:auto}
.mast{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #1a1c1c;padding-bottom:8px;margin-bottom:16px}.mast svg{width:100px;height:auto}
.meta,.lab{font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:#5e5e5e;text-align:right}
h1{font-size:24pt;font-weight:600;letter-spacing:-.03em;margin:0 0 4px}p{margin:2px 0 8px}.m{color:#5e5e5e;font-size:8.5pt}
.st{display:flex;gap:40px;margin:10px 0 12px}.st div{display:flex;flex-direction:column}.v{font-size:22pt;font-weight:600;letter-spacing:-.02em}.st .lab{text-align:left}
.warn{border:1px solid #1a1c1c;padding:6px 8px;margin:6px 0;font-weight:500}.none{font-size:12pt;font-weight:500;margin-top:16px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:600;font-size:8pt;border-bottom:1px solid #1a1c1c;padding:4px 6px 4px 0}
td{vertical-align:top;padding:5px 6px 5px 0;border-bottom:1px solid #cfc4c5}.n{text-align:right;white-space:nowrap}tr.s td{font-weight:600;font-size:10.5pt;padding-top:10px;border-bottom:1px solid #1a1c1c}
a{color:#1a1c1c}.foot{margin-top:auto;font-size:7.5pt;color:#5e5e5e;border-top:1px solid #cfc4c5;padding-top:5px;display:flex;justify-content:space-between}
</style></head><body>${body}</body></html>`;
}

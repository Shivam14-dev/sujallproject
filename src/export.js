// Dependency-free exporters: XLSX (Office Open XML in a ZIP), PDF (tabular), CSV.
import zlib from 'node:zlib';

// ---------- ZIP ----------
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEsc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export function toXlsx(report) {
  const { title, subtitle, columns, rows } = report;
  const lines = [];
  let r = 1;
  const cell = (c, v, style = 0) => {
    const ref = `${colName(c)}${r}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  lines.push(`<row r="${r}">${cell(0, title, 2)}</row>`); r++;
  if (subtitle) { lines.push(`<row r="${r}">${cell(0, subtitle)}</row>`); r++; }
  r++;
  const headerRow = r;
  lines.push(`<row r="${r}">${columns.map((c, i) => cell(i, c.label, 1)).join('')}</row>`); r++;
  for (const row of rows) { lines.push(`<row r="${r}">${columns.map((c, i) => cell(i, row[c.key] ?? '')).join('')}</row>`); r++; }
  const widths = columns.map((c) => Math.min(60, Math.max(c.label.length, ...rows.slice(0, 500).map((x) => String(x[c.key] ?? '').length)) + 2));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.join('')}</sheetData>
${rows.length ? `<autoFilter ref="A${headerRow}:${colName(columns.length - 1)}${headerRow + rows.length}"/>` : ''}
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BEA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;
  const sheetName = xmlEsc(String(title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName || 'Report'}" sheetId="1" r:id="rId1"/></sheets>${rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName || 'Report'}'!$A$${headerRow}:$${colName(columns.length - 1)}$${headerRow + rows.length}</definedName></definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: styles },
  ]);
}

// ---------- PDF ----------
const pdfText = (s) => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
const textWidth = (s, size) => String(s).length * size * 0.52;

export function toPdf(report, { schoolName = '' } = {}) {
  const { title, subtitle, columns, rows } = report;
  const W = 842, H = 595, M = 36, rowH = 16, fs = 8.5;
  const usable = W - 2 * M;
  const raw = columns.map((c) => Math.min(40, Math.max(c.label.length, ...rows.slice(0, 300).map((r) => String(r[c.key] ?? '').length), 3)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const widths = raw.map((w) => (w / sum) * usable);
  const fit = (s, w) => { s = String(s ?? ''); while (s.length > 1 && textWidth(s, fs) > w - 6) s = s.slice(0, -2) + '.'; return s; };

  const pages = [];
  let ops = [], y = 0, pageNo = 0;
  const startPage = () => {
    pageNo++; ops = []; y = H - M;
    if (pageNo === 1) {
      ops.push(`BT /F2 15 Tf ${M} ${y - 14} Td (${pdfText(title)}) Tj ET`);
      y -= 22;
      const sub = [schoolName, subtitle].filter(Boolean).join('  |  ');
      if (sub) { ops.push(`BT /F1 9 Tf 0.35 0.4 0.5 rg ${M} ${y - 10} Td (${pdfText(sub)}) Tj ET 0 0 0 rg`); y -= 18; }
      y -= 6;
    }
    // header row
    ops.push(`0.184 0.357 0.918 rg ${M} ${y - rowH} ${usable} ${rowH} re f 1 1 1 rg`);
    let x = M;
    columns.forEach((c, i) => { ops.push(`BT /F2 ${fs} Tf ${x + 3} ${y - 11} Td (${pdfText(fit(c.label, widths[i]))}) Tj ET`); x += widths[i]; });
    ops.push('0 0 0 rg');
    y -= rowH;
  };
  const endPage = () => {
    ops.push(`BT /F1 7.5 Tf 0.5 0.5 0.5 rg ${M} 20 Td (Generated ${pdfText(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC) Tj ET`);
    ops.push(`BT /F1 7.5 Tf ${W - M - 40} 20 Td (Page ${pageNo}) Tj ET 0 0 0 rg`);
    pages.push(ops.join('\n'));
  };
  startPage();
  if (!rows.length) { ops.push(`BT /F1 10 Tf ${M + 4} ${y - 18} Td (No records for the selected filters.) Tj ET`); }
  rows.forEach((r, idx) => {
    if (y - rowH < M + 10) { endPage(); startPage(); }
    if (idx % 2) ops.push(`0.957 0.968 0.988 rg ${M} ${y - rowH} ${usable} ${rowH} re f 0 0 0 rg`);
    let x = M;
    columns.forEach((c, i) => { ops.push(`BT /F1 ${fs} Tf ${x + 3} ${y - 11} Td (${pdfText(fit(r[c.key], widths[i]))}) Tj ET`); x += widths[i]; });
    ops.push(`0.88 0.9 0.94 RG 0.4 w ${M} ${y - rowH} m ${M + usable} ${y - rowH} l S`);
    y -= rowH;
  });
  endPage();

  // assemble objects
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const content of pages) {
    const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const c = add({ stream, dict: `<< /Length ${stream.length} /Filter /FlateDecode >>` });
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${pdfText(title)}) /Producer (School Portal) >>`);

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let len = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(len);
    let b;
    if (typeof o === 'string') b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    else b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    parts.push(b); len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// ---------- CSV ----------
export function toCsv(report) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [report.columns.map((c) => esc(c.label)).join(','), ...report.rows.map((r) => report.columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// ---------- XLSX import (first worksheet → array of rows) ----------
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.slice(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
export function parseXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  const ss = files['xl/sharedStrings.xml']?.toString('utf8');
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(xmlUnesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('No worksheet found');
  const xml = files[sheetName].toString('utf8');
  const rows = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
    const row = [];
    for (const c of rowXml.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1];
      const t = (c.match(/ t="(\w+)"/) || [])[1];
      let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's') v = shared[+v];
      else if (t === 'inlineStr') v = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      v = v === undefined ? '' : xmlUnesc(String(v));
      let idx = 0;
      if (ref) for (const ch of ref) idx = idx * 26 + (ch.charCodeAt(0) - 64);
      row[(idx || row.length + 1) - 1] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  }
  return rows;
}

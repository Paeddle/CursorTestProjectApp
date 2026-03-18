#!/usr/bin/env node
/**
 * Parse PO Line Report PDF and output CSV for app items.
 * Usage: node scripts/parse-po-report.mjs <path-to-POLineReport.pdf>
 */
import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = process.argv[2];
const outPath = join(__dirname, '..', 'public', 'po_line_report.csv');

if (!pdfPath) {
  console.error('Usage: node scripts/parse-po-report.mjs <path-to-POLineReport.pdf>');
  process.exit(1);
}

function escapeCsv(s) {
  if (s == null) return '';
  const str = String(s).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parsePOLines(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  const poRegex = /PO:(\d+)\s*\|\s*Item:([^|]+)\s*\|\s*For:([^\d$]+?)(\d+)/g;
  // Customer line: "Customer:Name:Project 2 2 0 $0.00" - capture name/job before the digit groups
  const customerRegex = /^Customer:(.+?)\s+\d+\s+\d+\s+/;
  let currentCustomer = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Update current customer when we see a Customer: line (skip summary lines like "Customer: 15 5 10 $...")
    if (trimmed.startsWith('Customer:')) {
      const afterLabel = trimmed.slice(9).trim();
      if (afterLabel && !/^\d/.test(afterLabel)) {
        const match = trimmed.match(customerRegex);
        if (match) currentCustomer = match[1].trim();
        else currentCustomer = afterLabel.replace(/\s+\d+.*$/, '').trim();
      }
      continue;
    }
    if (!trimmed.includes('PO:') || !trimmed.includes('| Item:')) continue;

    let m;
    const re = new RegExp(poRegex.source, 'g');
    while ((m = re.exec(trimmed)) !== null) {
      const poNumber = m[1];
      const itemName = m[2].trim();
      const forType = m[3].trim().replace(/\s+/g, ' ');
      const quantity = m[4];
      rows.push({
        po_number: `PO-${poNumber}`,
        item_name: itemName,
        part_number: '',
        description: forType ? `For: ${forType}` : '',
        color: '',
        quantity,
        customer: currentCustomer,
      });
    }
  }
  return rows;
}

async function main() {
  console.log('Reading PDF:', pdfPath);
  const buffer = await readFile(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  const text = result?.text ?? result?.pages?.map((p) => p.text).join('\n') ?? '';
  if (!text) {
    console.error('No text extracted from PDF');
    process.exit(1);
  }

  const rows = parsePOLines(text);
  console.log('Parsed', rows.length, 'PO line items');

  const header = 'PO Number,Item Name,Part Number,Description,Color,Quantity,Job Or Customer';
  const csvLines = [header];
  for (const r of rows) {
    csvLines.push(
      [escapeCsv(r.po_number), escapeCsv(r.item_name), escapeCsv(r.part_number), escapeCsv(r.description), escapeCsv(r.color), escapeCsv(r.quantity), escapeCsv(r.customer || '')].join(',')
    );
  }

  await writeFile(outPath, csvLines.join('\n'), 'utf8');
  console.log('Wrote', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

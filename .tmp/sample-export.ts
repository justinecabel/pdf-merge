import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import { generateMergedPdf } from '../app/lib/export-pdf.ts';

const fontBytes = await readFile('./public/fonts/NotoSans-Regular.ttf');
const fontBoldBytes = await readFile('./public/fonts/NotoSans-Bold.ttf');

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  return setTimeout(() => callback(0), 0) as unknown as number;
}) as typeof requestAnimationFrame;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/fonts/NotoSans-Regular.ttf')) return new Response(fontBytes, { status: 200 });
  if (url.endsWith('/fonts/NotoSans-Bold.ttf')) return new Response(fontBoldBytes, { status: 200 });
  throw new Error(`Unexpected font fetch: ${url}`);
}) as typeof fetch;

const source = await PDFDocument.create();
const page = source.addPage([612, 792]);
page.drawText('Sample PDF', { x: 60, y: 730, size: 30, color: rgb(0, 0, 0) });
page.drawText('Name', { x: 60, y: 620, size: 18, color: rgb(0, 0, 0) });
page.drawText('Order ID', { x: 60, y: 560, size: 18, color: rgb(0, 0, 0) });
page.drawRectangle({ x: 60, y: 470, width: 240, height: 90, borderColor: rgb(0, 0, 0), borderWidth: 1 });
const sourceBytes = await source.save();

const fields = [
  { id: 'name', type: 'text', name: 'Name', pageIndex: 0, layerIndex: 0, rect: { x: 0.12, y: 0.68, width: 0.38, height: 0.08 }, rotation: 0, style: { fontFamily: 'Noto Sans', fontWeight: 'regular', fontSize: 20, minFontSize: 8, color: '#111111', align: 'left', lineHeight: 1.2 } },
  { id: 'order', type: 'text', name: 'Order ID', pageIndex: 0, layerIndex: 1, rect: { x: 0.12, y: 0.52, width: 0.24, height: 0.08 }, rotation: 0, style: { fontFamily: 'Noto Sans', fontWeight: 'bold', fontSize: 18, minFontSize: 8, color: '#111111', align: 'left', lineHeight: 1.2 } },
];

const rows = [{ id: 'row-1', values: { name: 'Alice Johnson', order: 'INV-2048' } }];
const geometries = [{ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }];
const outputBytes = await generateMergedPdf(sourceBytes, fields, rows, geometries);
await writeFile('./.tmp/exported-sample.pdf', outputBytes);
const output = await PDFDocument.load(outputBytes);
console.log('created .tmp/exported-sample.pdf');
console.log('page count', output.getPageCount());
console.log('page size', output.getPage(0).getWidth(), output.getPage(0).getHeight());

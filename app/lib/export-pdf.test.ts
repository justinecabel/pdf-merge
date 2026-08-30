import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitText, generateMergedPdf } from './export-pdf';
import type { CustomFont, MergeRow, PageGeometry, TemplateField } from '../types';
import { readFile, writeFile } from 'node:fs/promises';

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    return setTimeout(() => callback(0), 0) as unknown as number;
  });
});

describe('PDF export', () => {
  it('shrinks and clips text to the configured box', () => {
    const font = { widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.5 };
    const lines = fitText('This line is much too long', font, 18, 6, 55, 20, 1.2);
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThan('This line is much too long'.length);
  });

  it('copies every source page once per merge row in row-major order', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([200, 300]);
    source.addPage([200, 300]);
    const sourceBytes = await source.save();
    const rows: MergeRow[] = Array.from({ length: 5 }, (_, index) => ({ id: `row-${index}`, values: {} }));
    const geometries: PageGeometry[] = Array.from({ length: 3 }, () => ({ width: 200, height: 300, transform: [1, 0, 0, -1, 0, 300] }));
    const outputBytes = await generateMergedPdf(sourceBytes, [], rows, geometries);
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(15);
  });

  it('draws personalized text and PNG content without changing source-page order', async () => {
    const fontBytes = await readFile('public/fonts/NotoSans-Regular.ttf');
    globalThis.fetch = async () => new Response(fontBytes);
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    const sourceBytes = await source.save();
    const fields: TemplateField[] = [
      {
        id: 'name', type: 'text', name: 'Recipient', pageIndex: 0, layerIndex: 0,
        rect: { x: 0.1, y: 0.15, width: 0.5, height: 0.08 }, rotation: 0,
        style: { fontFamily: 'Noto Sans', fontWeight: 'regular', fontSize: 18, minFontSize: 6, color: '#111111', align: 'left', lineHeight: 1.2 },
      },
      {
        id: 'mark', type: 'image', name: 'Mark', pageIndex: 1, layerIndex: 0,
        rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.15 }, rotation: 0,
        style: { fit: 'contain', opacity: 1, backgroundRemoval: 'off' },
      },
    ];
    const rows: MergeRow[] = [
      { id: 'a', values: { name: 'Ada Lovelace', mark: { kind: 'image', name: 'sample.png', dataUrl: pngDataUrl } } },
      { id: 'b', values: { name: 'Grace Hopper', mark: null } },
    ];
    const geometries: PageGeometry[] = Array.from({ length: 2 }, () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }));
    const outputBytes = await generateMergedPdf(sourceBytes, fields, rows, geometries);
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(4);
    expect(output.getPage(0).node.Contents()).toBeTruthy();
    if (process.env.WRITE_QA_PDF === '1') await writeFile('tmp/pdfs/generated-preview.pdf', outputBytes);
  });

  it('embeds an uploaded font face in the exported PDF', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const customFonts: CustomFont[] = [{
      id: 'uploaded-face', name: 'Uploaded Noto', previewFamily: 'Uploaded Noto',
      bytes: new Uint8Array(await readFile('public/fonts/NotoSans-Regular.ttf')),
    }];
    const fields: TemplateField[] = [{
      id: 'custom', type: 'text', name: 'Custom', pageIndex: 0, layerIndex: 0,
      rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, rotation: 0,
      style: { fontFamily: 'Uploaded Noto', fontFileId: 'uploaded-face', fontWeight: 'regular', fontSize: 18, minFontSize: 6, color: '#111111', align: 'left', lineHeight: 1.2 },
    }];
    const output = await generateMergedPdf(
      await source.save(), fields, [{ id: 'row', values: { custom: 'Uploaded face works' } }],
      [{ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }], undefined, customFonts,
    );
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  });

  it('embeds the built-in font selected for a template field', async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const fontBytes = await readFile('public/fonts/NotoSerif-Regular.ttf');
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(fontBytes);
    };
    try {
      const source = await PDFDocument.create();
      source.addPage([612, 792]);
      const fields: TemplateField[] = [{
        id: 'serif', type: 'text', name: 'Serif', pageIndex: 0, layerIndex: 0,
        rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, rotation: 0,
        style: { fontFamily: 'Noto Serif', fontWeight: 'regular', fontSize: 18, minFontSize: 6, color: '#111111', align: 'left', lineHeight: 1.2 },
      }];
      await generateMergedPdf(
        await source.save(), fields, [{ id: 'row', values: { serif: 'Selected serif font' } }],
        [{ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }],
      );
      expect(requests).toContain('/fonts/NotoSerif-Regular.ttf');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

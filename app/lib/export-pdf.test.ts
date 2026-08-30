import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitText, generateMergedPdf } from './export-pdf';
import type { MergeRow, PageGeometry, TemplateField } from '../types';

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

  it('draws personalized PNG content without changing source-page order', async () => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    const sourceBytes = await source.save();
    const fields: TemplateField[] = [
      {
        id: 'mark', type: 'image', name: 'Mark', pageIndex: 1, layerIndex: 0,
        rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.15 }, rotation: 0,
        style: { fit: 'contain', opacity: 1, backgroundRemoval: 'off' },
      },
    ];
    const rows: MergeRow[] = [
      { id: 'a', values: { mark: { kind: 'image', name: 'sample.png', dataUrl: pngDataUrl } } },
      { id: 'b', values: { mark: null } },
    ];
    const geometries: PageGeometry[] = Array.from({ length: 2 }, () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }));
    const outputBytes = await generateMergedPdf(sourceBytes, fields, rows, geometries);
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(4);
    expect(output.getPage(1).node.Contents()).toBeTruthy();
  });
});

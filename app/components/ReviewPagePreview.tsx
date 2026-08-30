'use client';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';
import { PdfCanvas } from './PdfCanvas';
import type { CustomFont, MergeRow, TemplateField } from '../types';

type Props = {
  document: PDFDocumentProxy;
  pageIndex: number;
  fields: TemplateField[];
  row: MergeRow | null;
  customFonts: CustomFont[];
  enhancedPageDataUrl?: string;
};

export function ReviewPagePreview({ document, pageIndex, fields, row, customFonts, enhancedPageDataUrl }: Props) {
  const [loadedPage, setLoadedPage] = useState<{ index: number; page: PDFPageProxy } | null>(null);
  const safePageIndex = Math.min(Math.max(pageIndex, 0), document.numPages - 1);

  useEffect(() => {
    let active = true;
    void document.getPage(safePageIndex + 1).then((page) => { if (active) setLoadedPage({ index: safePageIndex, page }); });
    return () => { active = false; };
  }, [document, safePageIndex]);

  if (!loadedPage || loadedPage.index !== safePageIndex) return <div className="review-page-loading">Rendering page…</div>;

  return <PdfCanvas
    page={loadedPage.page}
    zoom={1}
    fields={fields.filter((field) => field.pageIndex === safePageIndex)}
    row={row}
    customFonts={customFonts}
    selectedIds={[]}
    onSelect={() => undefined}
    onChange={() => undefined}
    onDelete={() => undefined}
    onFieldContextMenu={() => undefined}
    enhancedPageDataUrl={enhancedPageDataUrl}
    interactive={false}
  />;
}

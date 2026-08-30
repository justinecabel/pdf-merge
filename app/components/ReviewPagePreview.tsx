'use client';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';
import { PdfCanvas } from './PdfCanvas';
import type { CustomFont, MergeRow, TemplateField } from '../types';

type Props = {
  document: PDFDocumentProxy;
  fields: TemplateField[];
  row: MergeRow | null;
  customFonts: CustomFont[];
};

export function ReviewPagePreview({ document, fields, row, customFonts }: Props) {
  const [loadedPages, setLoadedPages] = useState<PDFPageProxy[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all(Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)))
      .then((pages) => { if (active) setLoadedPages(pages); });
    return () => { active = false; };
  }, [document]);

  if (loadedPages.length !== document.numPages) return <div className="review-page-loading">Rendering copy…</div>;

  return <div className="review-copy-stack">{loadedPages.map((page, pageIndex) => <section className="review-copy-page" key={pageIndex}>
    <div className="review-copy-page-label">Page {pageIndex + 1}</div>
    <PdfCanvas
      page={page}
      zoom={1}
      fields={fields.filter((field) => field.pageIndex === pageIndex)}
      row={row}
      customFonts={customFonts}
      selectedIds={[]}
      onSelect={() => undefined}
      onChange={() => undefined}
      onDelete={() => undefined}
      onFieldContextMenu={() => undefined}
      interactive={false}
    />
  </section>)}</div>;
}

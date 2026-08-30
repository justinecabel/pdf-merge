'use client';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { PdfCanvas } from './PdfCanvas';
import type { CustomFont, MergeRow, TemplateField } from '../types';

type Props = {
  document: PDFDocumentProxy;
  zoom: number;
  fields: TemplateField[];
  row: MergeRow | null;
  customFonts: CustomFont[];
  activePage: number;
  selectedIds: string[];
  placementMode: 'text' | 'image' | null;
  onActivatePage: (pageIndex: number) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<TemplateField>) => void;
  onDelete: (id: string) => void;
  onPageContextMenu: (pageIndex: number, position: { x: number; y: number }) => void;
  onFieldContextMenu: (fieldId: string, position: { x: number; y: number }) => void;
  onPlace: (type: 'text' | 'image', pageIndex: number, point: { x: number; y: number }) => void;
  onNudge: (fieldId: string, dx: number, dy: number) => void;
  enhancedPageImages?: Record<number, string>;
};

export function AllPagesCanvas({
  document, zoom, fields, row, customFonts, activePage, selectedIds, placementMode,
  onActivatePage, onSelect, onChange, onDelete, onPageContextMenu, onFieldContextMenu, onPlace, onNudge, enhancedPageImages = {},
}: Props) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all(Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)))
      .then((loaded) => { if (active) setPages(loaded); });
    return () => { active = false; };
  }, [document]);

  if (!pages.length) return <div className="page-loading">Rendering all pages…</div>;

  const openPageMenu = (event: ReactMouseEvent<HTMLElement>, pageIndex: number) => {
    const nativeEvent = event.nativeEvent as PointerEvent;
    const fieldTarget = event.target instanceof Element && event.target.closest('.field-box');
    // Touch long-presses and right-clicks on field controls are not page actions.
    if (nativeEvent.pointerType === 'touch' || event.button !== 2 || fieldTarget) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    onPageContextMenu(pageIndex, { x: event.clientX, y: event.clientY });
  };

  return (
    <div className="document-stack">
      {pages.map((page, pageIndex) => (
        <section key={pageIndex} data-page-index={pageIndex} className={`document-page${activePage === pageIndex ? ' active' : ''}`} onContextMenu={(event) => openPageMenu(event, pageIndex)}>
          <div className="document-page-label">Page {pageIndex + 1}</div>
          <PdfCanvas
            page={page}
            zoom={zoom}
            fields={fields.filter((field) => field.pageIndex === pageIndex)}
            row={row}
            customFonts={customFonts}
            selectedIds={selectedIds}
            placementMode={placementMode}
            onSelect={(id) => { onActivatePage(pageIndex); onSelect(id); }}
            onChange={onChange}
            onDelete={onDelete}
            onFieldContextMenu={onFieldContextMenu}
            onPlace={(type, point) => { onActivatePage(pageIndex); onPlace(type, pageIndex, point); }}
            onNudge={onNudge}
            enhancedPageDataUrl={enhancedPageImages[pageIndex]}
          />
        </section>
      ))}
    </div>
  );
}

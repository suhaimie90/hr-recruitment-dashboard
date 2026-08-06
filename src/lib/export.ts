/**
 * Client-side export helpers. Everything runs in the browser — no
 * server round trip, so exports reflect exactly what's on screen
 * including the active filters.
 */

type Cell = string | number | null | undefined;

/** RFC 4180: wrap in quotes, double any embedded quote. */
function escapeCell(value: Cell): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari cancels the download otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Rows are written as-is, so callers can interleave section headings
 * with data to build a multi-table sheet.
 *
 * The leading BOM matters: without it Excel reads the file as ANSI and
 * mangles non-ASCII names, which most of this applicant list has.
 */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * Rasterises a chart's <svg> to PNG.
 *
 * Charts are drawn onto a white background at 2x for a usable
 * screenshot — SVG is transparent, which looks broken pasted into a
 * slide deck or a report.
 *
 * Note: Recharts renders legends as HTML, not SVG, so a legend won't
 * appear in the exported image. The plot itself does.
 */
function svgImage(svg: SVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGElement;
  const rect = svg.getBoundingClientRect();
  clone.setAttribute('width', String(Math.ceil(rect.width) || 640));
  clone.setAttribute('height', String(Math.ceil(rect.height) || 320));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const source = new XMLSerializer().serializeToString(clone);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not rasterise a chart'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });
}

/** Combines every marked analytics panel into one report-ready PNG. */
export async function downloadDashboardAsPng(container: HTMLElement, filename: string): Promise<void> {
  const panels = Array.from(container.querySelectorAll<HTMLElement>('[data-chart-panel]'));
  if (!panels.length) throw new Error('No charts found to export');

  const columns = panels.length > 1 ? 2 : 1;
  const rows = Math.ceil(panels.length / columns);
  const panelWidth = 760;
  const panelHeight = 390;
  const gap = 24;
  const outer = 32;
  const heading = 72;
  const scale = 2;
  const width = outer * 2 + columns * panelWidth + (columns - 1) * gap;
  const height = outer * 2 + heading + rows * panelHeight + (rows - 1) * gap;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('SETIAHUB Recruitment Analytics', outer, outer + 26);
  ctx.fillStyle = '#64748b';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText(`Generated ${new Date().toLocaleString()}`, outer, outer + 50);

  await Promise.all(
    panels.map(async (panel, index) => {
      const svg = panel.querySelector('svg');
      if (!svg) return;
      const image = await svgImage(svg);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = outer + column * (panelWidth + gap);
      const y = outer + heading + row * (panelHeight + gap);

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, panelWidth, panelHeight, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = '700 15px Arial, sans-serif';
      ctx.fillText(panel.dataset.title || 'Chart', x + 20, y + 28);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Arial, sans-serif';
      const subtitle = panel.dataset.subtitle || '';
      const subtitleWidth = ctx.measureText(subtitle).width;
      ctx.fillText(subtitle, x + panelWidth - subtitleWidth - 20, y + 28);

      ctx.drawImage(image, x + 14, y + 46, panelWidth - 28, panelHeight - 60);
    })
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the dashboard');
  triggerDownload(blob, filename);
}

/** YYYY-MM-DD for filenames, so exports sort chronologically. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

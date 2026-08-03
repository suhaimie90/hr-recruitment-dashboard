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
export function downloadChartAsPng(container: HTMLElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const svg = container.querySelector('svg');
    if (!svg) {
      reject(new Error('No chart found to export'));
      return;
    }

    const rect = svg.getBoundingClientRect();
    const width = Math.ceil(rect.width) || 640;
    const height = Math.ceil(rect.height) || 320;
    const scale = 2;

    // Clone so the explicit size doesn't disturb the live chart.
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const xml = new XMLSerializer().serializeToString(clone);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not render the chart'));
          return;
        }
        triggerDownload(blob, filename);
        resolve();
      }, 'image/png');
    };

    img.onerror = () => reject(new Error('Could not rasterise the chart'));
    img.src = svgUrl;
  });
}

/** YYYY-MM-DD for filenames, so exports sort chronologically. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

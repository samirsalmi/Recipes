/** Minimal PDF 1.4 writer: one full-bleed JPEG per page, no dependencies. The grocery PDF is
 *  drawn with the browser's own text engine (so Arabic shaping, RTL and the app fonts come out
 *  right) and embedded as images here. Pure (bytes in, bytes out), unit-tested. */
export interface PdfImagePage {
  /** JPEG file bytes. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

export interface PdfOptions {
  /** Page size in points (default A4 portrait). */
  pageWidth?: number;
  pageHeight?: number;
  title?: string;
  author?: string;
  /** Document language tag, e.g. "ar". */
  lang?: string;
}

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

const encoder = new TextEncoder();

/** A PDF text string: PDFDocEncoding for ASCII, UTF-16BE hex otherwise (Arabic titles). */
export function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return '(' + text.replace(/([\\()])/g, '\\$1') + ')';
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

export function buildImagePdf(pages: PdfImagePage[], options: PdfOptions = {}): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page');
  const pw = options.pageWidth ?? A4_WIDTH_PT;
  const ph = options.pageHeight ?? A4_HEIGHT_PT;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}`);
    if (stream) {
      push('\nstream\n');
      push(stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  };

  // ids: 1 catalog, 2 pages tree, 3 info, then (page, content, image) per page.
  const pageId = (n: number) => 4 + n * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, `<< /Type /Catalog /Pages 2 0 R${options.lang ? ` /Lang ${pdfString(options.lang)}` : ''} >>`);
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, n) => `${pageId(n)} 0 R`).join(' ')}] >>`);
  object(3, `<< /Producer (Mise)${options.title ? ` /Title ${pdfString(options.title)}` : ''}${options.author ? ` /Author ${pdfString(options.author)}` : ''} >>`);
  pages.forEach((page, n) => {
    const id = pageId(n);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const content = encoder.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`, page.jpeg);
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

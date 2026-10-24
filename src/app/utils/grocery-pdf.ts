import type { GroceryPdfModel, PdfRow, PdfSection } from './grocery-pdf-model';
import { A4_HEIGHT_PT, A4_WIDTH_PT, buildImagePdf } from './pdf-writer';

/* Lazy chunk (dynamic import from the groceries page). Draws the A4 pages with the browser's
 * text engine on a canvas - so Arabic shaping, bidi and the app fonts are exact - and wraps the
 * JPEGs in a PDF. Light palette = the :root design tokens of src/styles.scss (print is always light). */

const COLORS = {
  paper: 'rgb(250, 247, 242)', // --paper
  ink: 'rgb(30, 27, 22)', // --ink
  muted: 'rgb(107, 100, 90)', // --muted
  hairline: 'rgb(233, 227, 216)', // --hairline
  rule: 'rgb(205, 196, 180)', // hairline, darkened so dividers survive a mono printer
  sunken: 'rgb(243, 238, 230)', // --sunken
  primary: 'rgb(31, 77, 58)', // --primary
  tint: 'rgb(227, 237, 231)', // --primary-tint
  accent: 'rgb(217, 83, 43)', // --accent (paprika)
  saffron: 'rgb(232, 176, 75)', // --saffron
  white: 'rgb(255, 255, 255)',
};

const DISPLAY = '"Fraunces Variable", "Noto Naskh Arabic Variable", Georgia, serif';
const BODY = '"Inter Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';
const SCALE = 2.2; // canvas px per point (~160 dpi)
const MARGIN = 38;
const GAP = 22;
const FOOTER_H = 26;

type Align = 'start' | 'end' | 'center';
interface Style { font: string; color: string; size: number }

/** Loads the font faces (and the unicode-range subsets the text needs) before measuring. */
async function loadFonts(model: GroceryPdfModel): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  const sample = JSON.stringify(model);
  const loads: Promise<unknown>[] = [];
  for (const spec of [
    `600 20px "Fraunces Variable"`, `400 12px "Inter Variable"`, `500 12px "Inter Variable"`, `600 12px "Inter Variable"`,
    `400 12px "IBM Plex Sans Arabic"`, `600 12px "IBM Plex Sans Arabic"`, `700 12px "IBM Plex Sans Arabic"`, `600 20px "Noto Naskh Arabic Variable"`,
  ]) loads.push(fonts.load(spec, sample).catch(() => undefined));
  await Promise.all(loads);
  await fonts.ready;
}

class Page {
  readonly ops: ((c: Painter) => void)[] = [];
}

/** Draws in logical (LTR) coordinates in points; mirrors x for RTL documents. */
class Painter {
  constructor(readonly ctx: CanvasRenderingContext2D, readonly rtl: boolean) {}

  private px(x: number, w: number): number {
    return this.rtl ? A4_WIDTH_PT - x - w : x;
  }

  rect(x: number, y: number, w: number, h: number, fill: string, radius = 0): void {
    const c = this.ctx;
    c.fillStyle = fill;
    c.beginPath();
    if (radius) c.roundRect(this.px(x, w), y, w, h, radius);
    else c.rect(this.px(x, w), y, w, h);
    c.fill();
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, lineWidth: number, radius = 0): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    c.roundRect(this.px(x, w) + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth, radius);
    c.stroke();
  }

  line(x: number, y: number, w: number, color: string, lineWidth = 0.6): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    c.moveTo(this.px(x, w), y);
    c.lineTo(this.px(x, w) + w, y);
    c.stroke();
  }

  check(x: number, y: number, size: number, color: string): void {
    const c = this.ctx;
    const x0 = this.px(x, size);
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(x0 + size * 0.24, y + size * 0.54);
    c.lineTo(x0 + size * 0.43, y + size * 0.73);
    c.lineTo(x0 + size * 0.78, y + size * 0.28);
    c.stroke();
  }

  /** Text on baseline `y` inside the logical box [x, x + w]; align is relative to the reading direction. */
  text(s: string, x: number, y: number, w: number, style: Style, align: Align = 'start', strike = false): void {
    const c = this.ctx;
    c.font = style.font;
    c.fillStyle = style.color;
    c.direction = this.rtl ? 'rtl' : 'ltr';
    c.textBaseline = 'alphabetic';
    const left = this.px(x, w);
    const physical = align === 'center' ? 'center' : (align === 'start') === !this.rtl ? 'left' : 'right';
    c.textAlign = physical;
    const ax = physical === 'center' ? left + w / 2 : physical === 'left' ? left : left + w;
    c.fillText(s, ax, y);
    if (strike) {
      const tw = c.measureText(s).width;
      const sx = physical === 'center' ? ax - tw / 2 : physical === 'left' ? ax : ax - tw;
      c.strokeStyle = style.color;
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(sx, y - style.size * 0.3);
      c.lineTo(sx + tw, y - style.size * 0.3);
      c.stroke();
    }
  }
}

function font(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

/** Greedy word wrap into at most `maxLines` lines (the last one ellipsized). */
function wrap(ctx: CanvasRenderingContext2D, text: string, f: string, width: number, maxLines: number): string[] {
  ctx.font = f;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      line = `${line} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(line);
    line = words[i];
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  let last = lines[lines.length - 1] ?? '';
  if (last && ctx.measureText(last).width > width) {
    while (last.length > 1 && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[lines.length - 1] = last.trimEnd() + '…';
  }
  return lines;
}

interface Block {
  h: number;
  /** A heading keeps company with the row after it. */
  keepNext?: boolean;
  draw: (p: Painter, x: number, y: number, w: number) => void;
}

function layoutBlocks(ctx: CanvasRenderingContext2D, model: GroceryPdfModel, colW: number): Block[] {
  const blocks: Block[] = [];
  const ar = model.lang === 'ar';
  const nameFont = font(500, ar ? 10.5 : 10, BODY);
  const doneFont = font(400, ar ? 10.5 : 10, BODY);
  const amountFont = font(600, ar ? 10 : 9.5, BODY);
  const noteFont = font(400, 8.5, BODY);
  const headFont = font(600, ar ? 14 : 12.5, DISPLAY);
  const lh = ar ? 14 : 12.5;
  const boxSize = 9.5;
  const textX = boxSize + 8;

  const heading = (s: PdfSection, cont: boolean): Block => ({
    h: 38,
    keepNext: true,
    draw: (p, x, y, w) => {
      const color = s.kind === 'buy' ? COLORS.primary : COLORS.muted;
      p.text(s.title + (cont ? ' …' : ''), x, y + 23, w - 26, { font: headFont, color, size: 12.5 });
      if (!cont) {
        const bw = 20;
        p.rect(x + w - bw, y + 10, bw, 16, s.kind === 'buy' ? COLORS.tint : COLORS.sunken, 8);
        p.text(String(s.count), x + w - bw, y + 21.5, bw, { font: font(600, 9, BODY), color: color, size: 9 }, 'center');
      }
      p.line(x, y + 32, w, s.kind === 'buy' ? COLORS.primary : COLORS.rule, s.kind === 'buy' ? 1.1 : 0.7);
    },
  });

  const row = (r: PdfRow, kind: PdfSection['kind']): Block => {
    const done = kind !== 'buy';
    const amountColor = done ? COLORS.muted : r.more ? COLORS.accent : COLORS.primary;
    ctx.font = amountFont;
    let amountW = r.amount ? Math.ceil(ctx.measureText(r.amount).width) + 4 : 0;
    const stack = amountW > (colW - textX) * 0.5;
    const nameW = colW - textX - (stack ? 0 : amountW + 8);
    const nameLines = wrap(ctx, r.name, done ? doneFont : nameFont, nameW, 2);
    const lines = nameLines.length + (stack && r.amount ? 1 : 0) + (r.note ? 1 : 0);
    if (stack) amountW = 0;
    const h = lines * lh + 8;
    return {
      h,
      draw: (p, x, y, w) => {
        const top = y + 4.5;
        if (kind === 'buy') {
          p.strokeRect(x, top + 0.5, boxSize, boxSize, COLORS.muted, 1, 2);
        } else {
          p.rect(x, top + 0.5, boxSize, boxSize, kind === 'done' ? COLORS.primary : COLORS.muted, 2);
          p.check(x, top + 0.5, boxSize, COLORS.white);
        }
        const style: Style = { font: done ? doneFont : nameFont, color: done ? COLORS.muted : COLORS.ink, size: 10 };
        let base = top + lh - 3;
        for (const line of nameLines) {
          p.text(line, x + textX, base, nameW, style, 'start', done);
          base += lh;
        }
        if (r.amount) {
          const st: Style = { font: amountFont, color: amountColor, size: 9.5 };
          if (stack) {
            p.text(r.amount, x + textX, base, w - textX, st, 'start', done);
            base += lh;
          } else {
            p.text(r.amount, x + w - amountW, top + lh - 3, amountW, st, 'end', done);
          }
        }
        if (r.note) p.text(r.note, x + textX, base - 1, w - textX, { font: noteFont, color: COLORS.muted, size: 8.5 });
        p.line(x, y + h - 0.3, w, COLORS.hairline, 0.6);
      },
    };
  };

  for (const s of model.sections) {
    blocks.push({ ...heading(s, false), ...{ section: s } } as Block);
    for (const r of s.rows) blocks.push({ ...row(r, s.kind), ...{ section: s } } as Block);
  }
  return blocks;
}

interface Placed { block: Block; col: number; y: number; page: number }

/** Flows blocks into two-column pages: full columns, except the last page, whose columns are balanced. */
function flow(blocks: (Block & { section?: PdfSection })[], top1: number, topN: number, bottom: number, headingFor: (s: PdfSection) => Block): { placed: Placed[]; pages: number; endY: number } {
  const run = (lastPageLimit: { page: number; height: number } | null) => {
    const placed: Placed[] = [];
    let page = 0;
    let col = 0;
    let y = top1;
    let lastSection: PdfSection | undefined;
    const top = (pg: number) => (pg === 0 ? top1 : topN);
    const colBottom = (pg: number) => (lastPageLimit && pg === lastPageLimit.page ? Math.min(bottom, top(pg) + lastPageLimit.height) : bottom);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const need = b.h + (b.keepNext ? (blocks[i + 1]?.h ?? 0) + (blocks[i + 2]?.h ?? 0) : 0);
      if (y + need > colBottom(page) + 0.01 && y > top(page)) {
        if (col === 0) col = 1;
        else { col = 0; page++; }
        y = top(page);
        // A section continuing in a new column gets a "…" heading again.
        if (!b.keepNext && b.section && b.section === lastSection) {
          const h = headingFor(b.section);
          placed.push({ block: h, col, y, page });
          y += h.h;
        }
      }
      placed.push({ block: b, col, y, page });
      y += b.h;
      if (b.section) lastSection = b.section;
    }
    const onLast = placed.filter(pl => pl.page === page);
    const endY = onLast.length ? Math.max(...onLast.map(pl => pl.y + pl.block.h)) : top1;
    return { placed, pages: page + 1, endY, onLast };
  };
  const first = run(null);
  const lastPage = first.pages - 1;
  const used = first.onLast.reduce((n, pl) => n + pl.block.h, 0);
  const balanced = run({ page: lastPage, height: used / 2 + 40 });
  const best = balanced.pages === first.pages ? balanced : first;
  return { placed: best.placed, pages: best.pages, endY: best.endY };
}

export async function renderGroceryPdf(model: GroceryPdfModel): Promise<Blob> {
  await loadFonts(model);
  const rtl = model.rtl;
  const ar = model.lang === 'ar';
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_WIDTH_PT * SCALE);
  canvas.height = Math.round(A4_HEIGHT_PT * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(SCALE, SCALE);

  const contentW = A4_WIDTH_PT - MARGIN * 2;
  const colW = (contentW - GAP) / 2;

  // ---- header (page 1) ----
  const headerH = 150;
  const top1 = MARGIN + headerH;
  const topN = MARGIN + 30;
  const bottom = A4_HEIGHT_PT - MARGIN - FOOTER_H;

  const blocks = layoutBlocks(ctx, model, colW) as (Block & { section?: PdfSection })[];
  // Continuation headings: reuse heading drawing with a "…" suffix and no count badge.
  const contHeading = (s: PdfSection): Block => ({
    h: 38,
    draw: (p, x, y, w) => {
      p.text(s.title + ' …', x, y + 23, w, { font: font(600, ar ? 14 : 12.5, DISPLAY), color: s.kind === 'buy' ? COLORS.primary : COLORS.muted, size: 12.5 }, 'start');
      p.line(x, y + 32, w, COLORS.rule, 0.7);
    },
  });

  const { placed, pages: pageCount, endY } = flow(blocks, top1, topN, bottom, contHeading);

  // ---- notes under the columns (full width) ----
  const pages: Page[] = Array.from({ length: pageCount }, () => new Page());
  for (const pl of placed) {
    const x = pl.col === 0 ? MARGIN : MARGIN + colW + GAP;
    pages[pl.page].ops.push(p => pl.block.draw(p, x, pl.y, colW));
  }
  let noteY = (blocks.length ? endY : top1) + 18;
  let notePage = pageCount - 1;
  const noteBody = font(400, ar ? 10 : 9.5, BODY);
  for (const note of model.notes) {
    const lines = wrap(ctx, note.text, noteBody, contentW, 6);
    const h = 24 + lines.length * (ar ? 14 : 12.5) + 4;
    if (noteY + h > bottom) {
      pages.push(new Page());
      notePage++;
      noteY = topN;
    }
    const y0 = noteY;
    pages[notePage].ops.push(p => {
      p.rect(MARGIN, y0, contentW, h, COLORS.sunken, 8);
      p.text(note.title, MARGIN + 12, y0 + 17, contentW - 24, { font: font(600, ar ? 11 : 10, BODY), color: COLORS.primary, size: 10 });
      lines.forEach((ln, i) => p.text(ln, MARGIN + 12, y0 + 33 + i * (ar ? 14 : 12.5), contentW - 24, { font: noteBody, color: COLORS.ink, size: 9.5 }));
    });
    noteY += h + 10;
  }

  // ---- empty state ----
  if (model.emptyText) {
    const t = model.emptyText;
    pages[0].ops.push(p => p.text(t, MARGIN, top1 + 40, contentW, { font: font(400, 13, BODY), color: COLORS.muted, size: 13 }, 'center'));
  }

  // ---- header + footers ----
  pages[0].ops.unshift(p => {
    // wordmark + saffron dot
    p.text(model.brand, MARGIN, MARGIN + 22, 120, { font: font(600, 26, DISPLAY), color: COLORS.primary, size: 26 });
    const mw = (() => { ctx.font = font(600, 26, DISPLAY); return ctx.measureText(model.brand).width; })();
    p.rect(MARGIN + mw + 5, MARGIN + 17, 6, 6, COLORS.saffron, 3);
    p.text(model.generated, MARGIN + contentW - 200, MARGIN + 20, 200, { font: font(500, 9.5, BODY), color: COLORS.muted, size: 9.5 }, 'end');
    p.rect(MARGIN, MARGIN + 36, contentW, 2, COLORS.primary);
    p.rect(MARGIN, MARGIN + 38, 46, 2, COLORS.saffron);
    // title block
    p.text(model.title, MARGIN, MARGIN + 82, contentW, { font: font(600, ar ? 32 : 34, DISPLAY), color: COLORS.ink, size: 34 });
    const sub = [model.range, model.household].filter(Boolean).join('   ·   ');
    if (sub) p.text(sub, MARGIN, MARGIN + 104, contentW, { font: font(500, ar ? 12 : 11, BODY), color: COLORS.muted, size: 11 });
    // stat pills
    let sx = MARGIN;
    for (const s of model.stats) {
      ctx.font = font(600, ar ? 10.5 : 10, BODY);
      const w = Math.ceil(ctx.measureText(s.label).width) + 22;
      const buy = s.kind === 'buy';
      p.rect(sx, MARGIN + 116, w, 22, buy ? COLORS.primary : COLORS.sunken, 11);
      p.text(s.label, sx, MARGIN + 131, w, { font: font(600, ar ? 10.5 : 10, BODY), color: buy ? COLORS.white : COLORS.muted, size: 10 }, 'center');
      sx += w + 8;
    }
  });
  pages.forEach((pg, i) => {
    pg.ops.push(p => {
      const y = A4_HEIGHT_PT - MARGIN - 6;
      p.line(MARGIN, y - 12, contentW, COLORS.hairline, 0.7);
      p.text(`${model.brand} · ${model.title}`, MARGIN, y, contentW / 2, { font: font(500, 8.5, BODY), color: COLORS.muted, size: 8.5 }, 'start');
      const label = model.pageTemplate.replace('{page}', String(i + 1)).replace('{total}', String(pages.length));
      p.text(label, MARGIN + contentW / 2, y, contentW / 2, { font: font(500, 8.5, BODY), color: COLORS.muted, size: 8.5 }, 'end');
    });
  });

  // ---- rasterize ----
  const painter = new Painter(ctx, rtl);
  const jpegs: { jpeg: Uint8Array; width: number; height: number }[] = [];
  for (const pg of pages) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.save();
    for (const op of pg.ops) op(painter);
    ctx.restore();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('could not encode the page');
    jpegs.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  const bytes = buildImagePdf(jpegs, { title: `${model.title} - ${model.range}`.trim(), author: 'Mise', lang: model.lang });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

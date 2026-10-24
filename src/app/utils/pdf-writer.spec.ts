import { buildImagePdf, pdfString } from './pdf-writer';

const fakeJpeg = (n: number) => new Uint8Array([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => i % 250), 0xff, 0xd9]);
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('buildImagePdf', () => {
  it('writes a PDF that starts with %PDF and ends with %%EOF', () => {
    const bytes = buildImagePdf([{ jpeg: fakeJpeg(40), width: 100, height: 140 }], { title: 'Shopping list' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(text(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(text(bytes.subarray(bytes.length - 6)).trim()).toBe('%%EOF');
  });

  it('has one page object per image and a matching /Count', () => {
    const bytes = buildImagePdf([1, 2, 3].map(n => ({ jpeg: fakeJpeg(10 * n), width: 10, height: 14 })));
    const src = text(bytes);
    expect(src).toContain('/Count 3');
    expect((src.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect((src.match(/\/DCTDecode/g) ?? []).length).toBe(3);
  });

  it('points startxref at the xref table and every xref entry at its object', () => {
    const bytes = buildImagePdf([{ jpeg: fakeJpeg(33), width: 10, height: 14 }, { jpeg: fakeJpeg(7), width: 10, height: 14 }]);
    const src = text(bytes);
    const xrefAt = Number(/startxref\n(\d+)/.exec(src)![1]);
    expect(src.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...src.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
    expect(entries.length).toBe(9);
    entries.forEach((offset, i) => expect(src.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('embeds the JPEG bytes untouched', () => {
    const jpeg = fakeJpeg(64);
    const bytes = buildImagePdf([{ jpeg, width: 10, height: 14 }]);
    const at = text(bytes).indexOf('stream\nÿØ') + 7;
    expect(Array.from(bytes.subarray(at, at + jpeg.length))).toEqual(Array.from(jpeg));
  });

  it('refuses an empty document', () => {
    expect(() => buildImagePdf([])).toThrow();
  });
});

describe('pdfString', () => {
  it('escapes ASCII and encodes anything else as UTF-16BE hex', () => {
    expect(pdfString('a (b)')).toBe('(a \\(b\\))');
    expect(pdfString('قائمة')).toMatch(/^<FEFF0642/);
  });
});

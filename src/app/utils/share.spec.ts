import { copyText, downloadBlob } from './share';

describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to execCommand when the Clipboard API is missing (insecure origin)', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('milk')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('resolves false when every path fails', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    (document as unknown as { execCommand: unknown }).execCommand = () => false;
    expect(await copyText('milk')).toBe(false);
  });
});

describe('downloadBlob', () => {
  it('clicks a download link with the file name', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(downloadBlob(new Blob(['x']), 'list.pdf')).toBe(true);
    expect(click).toHaveBeenCalled();
  });
});

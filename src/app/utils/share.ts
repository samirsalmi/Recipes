/** Robust sharing helpers. The Web Share API and the async Clipboard API exist only in secure
 *  contexts (https or localhost), so over plain http on the LAN (http://192.168.x.x:4200) both are
 *  undefined; every helper therefore feature-detects and has a fallback that works anywhere. */

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Opens the native share sheet with a file. Must be called straight from a tap handler (iOS
 *  Safari rejects with NotAllowedError once the user-activation window has passed). */
export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  if (!canShareFiles(file)) return 'unsupported';
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'unsupported';
  try {
    await navigator.share({ title, text });
    return 'shared';
  } catch (e) {
    return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Saves a blob as a file (anchor download); falls back to opening it in a new tab. */
export function downloadBlob(blob: Blob, fileName: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return openBlob(blob);
  }
}

export function openBlob(blob: Blob): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return !!w;
  } catch {
    return false;
  }
}

/** Copies text: async Clipboard API when available, else a hidden textarea + execCommand('copy')
 *  (works over http and in old WebViews). Resolves false when both fail. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied / not focused: try the legacy path
  }
  return execCopy(text);
}

function execCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;inset-inline-start:0;width:1px;height:1px;opacity:0;font-size:16px';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    active?.focus?.({ preventScroll: true });
  }
}

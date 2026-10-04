import { environment } from '../../environments/environment';

/** Asks Cloudinary for a resized, compressed rendition instead of the full-size upload
 * (~320KB each), so photos arrive in a fraction of the time on slow connections. f_auto
 * also lets browsers without AVIF support get a format they can show. Non-Cloudinary
 * URLs are returned unchanged. In dev builds the request is routed through the backend's
 * `/images/proxy` (Redis-cached) so a phone on the PC's hotspot only needs to reach the PC. */
export function optimizeImage(url: string, width: number): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  const optimized = url
    .replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width}/`)
    .replace(/\.(avif|webp|jpe?g|png)$/i, '');
  // In dev the phone may only reach the PC (hotspot), not Cloudinary - go through the backend.
  return environment.production
    ? optimized
    : `${environment.apiBaseUrl}/images/proxy?url=${encodeURIComponent(optimized)}`;
}

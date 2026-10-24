import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Warm, distinct tints that read in light and dark mode (white initial on top).
const TINTS = ['#1F4D3A', '#B5462A', '#8A5A12', '#3D5A80', '#6D3B6E', '#2F6B5E', '#7A4E2D'];

/** Initial in a coloured circle, stable per name (who added a meal, household members). */
@Component({
  selector: 'app-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <span class="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface"
          [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.45"
          [style.background]="tint()" [attr.title]="name()" [attr.aria-label]="name()" role="img">{{ initial() }}</span>
  `,
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly size = input(28);
  readonly initial = computed(() => (this.name().trim()[0] ?? '?').toUpperCase());
  readonly tint = computed(() => TINTS[hash(this.name()) % TINTS.length]);
}

/** Small stable string hash (also used for cuisine monogram tints). */
export function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export { TINTS as AVATAR_TINTS };

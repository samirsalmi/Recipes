import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Inline stroke icons (24x24, 1.75 stroke, currentColor), Lucide-style paths drawn for this app.
const PATHS: Record<string, string> = {
  discover: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M15.5 8.5l-2 5-5 2 2-5 5-2Z',
  plan: 'M8 3v3 M16 3v3 M4 8h16 M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M8 12h3 M8 16h6',
  groceries: 'M4 9h16l-1.5 10.2a1 1 0 0 1-1 .8h-11a1 1 0 0 1-1-.8L4 9Z M8 9l3-5 M16 9l-3-5 M9.5 13v3.5 M14.5 13v3.5',
  cookbook: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3 M9 7h6',
  household: 'M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.5c1.8.9 3 2.9 3 5.5',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'arrow-left': 'M19 12H5 M11 6l-6 6 6 6',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3 M10 16l-4-4 4-4 M6 12h10',
  leaf: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z M5 19l7-7',
  coins: 'M9 10c3.3 0 6-1.1 6-2.5S12.3 5 9 5 3 6.1 3 7.5 5.7 10 9 10Z M3 7.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4 M15 12.2c3.3-.2 6-1.2 6-2.5 M21 9.7v4c0 1.4-2.7 2.5-6 2.5 M3 11.5v4C3 16.9 5.7 18 9 18s6-1.1 6-2.5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 9v4 M10 2h4',
  flame: 'M12 21c3.9 0 7-2.7 7-6.5 0-4-3-6-4-9.5-2 2-2.5 4-2.5 5.5-1.5-1-2.5-2.5-2.5-4.5C7 8 5 11 5 14.5 5 18.3 8.1 21 12 21Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  fish: 'M3 12c3-5 9-6 14-3l4-3v12l-4-3c-5 3-11 2-14-3Z M15 11.5h.01',
  egg: 'M12 21c3.9 0 7-2.9 7-7 0-5-3.5-11-7-11S5 9 5 14c0 4.1 3.1 7 7 7Z',
  bread: 'M5 10a4 4 0 0 1 2-7h10a4 4 0 0 1 2 7v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9Z',
  jar: 'M8 3h8 M7 6h10 M7 6a3 3 0 0 0-2 3v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a3 3 0 0 0-2-3 M8 12h8',
  spice: 'M9 3h6v3H9z M8 6h8l1 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9l1-3Z M10 13h.01 M14 13h.01 M12 16h.01',
  snowflake: 'M12 2v20 M4 7l16 10 M20 7L4 17 M9 3l3 3 3-3 M9 21l3-3 3 3',
  cup: 'M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8Z M17 10h1.5a2.5 2.5 0 0 1 0 5H17 M8 3v2 M12 3v2',
  spray: 'M9 8h6v12a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V8Z M10 8V5h4v3 M14 5h3 M19 3v.01 M19 7v.01 M21 5v.01',
  dots: 'M6 12h.01 M12 12h.01 M18 12h.01',
  more: 'M12 6h.01 M12 12h.01 M12 18h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
  print: 'M7 9V3h10v6 M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2 M7 14h10v7H7z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9 M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  grip: 'M9 6h.01 M9 12h.01 M9 18h.01 M15 6h.01 M15 12h.01 M15 18h.01',
  filter: 'M4 6h16 M7 12h10 M10 18h4',
  pot: 'M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7Z M2 10h2 M20 10h2 M9 6c0-1 1-1.5 1-2.5 M13 6c0-1 1-1.5 1-2.5',
};

/** Icons that point somewhere (back/next arrows, log out): flipped under `dir="rtl"`. */
const DIRECTIONAL = new Set(['chevron-left', 'chevron-right', 'arrow-left', 'logout']);

/** `<app-icon name="heart" />` - decorative by default; pass `label` to make it meaningful. */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none"
         [attr.stroke]="'currentColor'" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
         [attr.aria-hidden]="label() ? null : 'true'" [attr.aria-label]="label() || null" [attr.role]="label() ? 'img' : null">
      <path [attr.d]="path()" [attr.fill]="filled() ? 'currentColor' : 'none'" />
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input(22);
  readonly filled = input(false);
  readonly label = input('');
  readonly path = computed(() => PATHS[this.name()] ?? PATHS['sparkle']);
  /** Direction-bearing icons mirror in right-to-left layouts. */
  readonly hostClass = computed(() => (DIRECTIONAL.has(this.name()) ? 'inline-flex shrink-0 rtl:-scale-x-100' : 'inline-flex shrink-0'));
}

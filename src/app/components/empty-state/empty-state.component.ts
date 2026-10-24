import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** Friendly empty state: icon, title, text, and projected actions (buttons/links). */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-sm flex-col items-center px-4 py-10 text-center">
      <span class="flex h-16 w-16 items-center justify-center rounded-full bg-primary-tint text-primary">
        <app-icon [name]="icon()" [size]="30" />
      </span>
      <h2 class="mt-4 font-display text-xl font-semibold">{{ title() }}</h2>
      @if (text()) { <p class="mt-1 text-muted">{{ text() }}</p> }
      <div class="mt-5 flex flex-wrap justify-center gap-2"><ng-content /></div>
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input('sparkle');
  readonly title = input.required<string>();
  readonly text = input('');
}

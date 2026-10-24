import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LANGUAGES, LANGUAGE_NAMES, Language } from '../../i18n/config';
import { I18nService } from '../../i18n/i18n.service';
import { ToastService } from '../../services/toast.service';

/** Language choice (English / Français / العربية), always shown in each language's own name.
 *  Switches the UI immediately and, when signed in, saves it on the account. Used in the
 *  desktop nav, on the login/register pages, in Discover for guests on mobile, and in
 *  Household (full size). */
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex gap-1.5" [class.flex-wrap]="!compact()" [class.shrink-0]="compact()" role="radiogroup" [attr.aria-label]="i18n.t('lang.label')" data-qa="language-switcher">
      @for (lang of languages; track lang) {
        <button type="button" role="radio" class="chip" [class.chip-active]="i18n.language() === lang"
                [class.min-h-[32px]]="compact()" [class.px-3]="compact()" [class.text-xs]="compact()"
                [attr.aria-checked]="i18n.language() === lang" [attr.lang]="lang" [attr.aria-label]="names[lang]" [attr.title]="names[lang]" [attr.data-qa]="'lang-' + lang"
                (click)="choose(lang)">{{ names[lang] }}</button>
      }
    </div>
  `,
})
export class LanguageSwitcherComponent {
  protected readonly i18n = inject(I18nService);
  private toast = inject(ToastService);

  /** Smaller chips for the nav bar. */
  readonly compact = input(false);
  protected readonly languages = LANGUAGES;
  protected readonly names = LANGUAGE_NAMES;

  choose(lang: Language): void {
    if (lang === this.i18n.language()) return;
    this.i18n.setLanguage(lang).subscribe({
      error: () => this.toast.show(this.i18n.t('lang.saveFailed'), 'error'),
    });
  }
}

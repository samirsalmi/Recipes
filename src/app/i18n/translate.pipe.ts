import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, Params } from './i18n.service';
import { TranslationKey } from './en';

/** `{{ 'nav.discover' | t }}` / `{{ 'common.servings' | t: { count: 3 } }}`. Impure on purpose: it
 *  reads the language signal, so bindings update when the language changes. Prefer `t()` from
 *  the component for anything computed. */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(key: TranslationKey, params?: Params): string {
    return this.i18n.t(key, params);
  }
}

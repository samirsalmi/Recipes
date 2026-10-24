import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { ToastService } from './toast.service';

export interface CookingTimer {
  id: number;
  label: string;
  /** e.g. the recipe name, shown under the label. */
  context: string;
  durationMs: number;
  endsAt: number;
  /** Set while paused: the time that was left. */
  pausedRemainingMs: number | null;
  done: boolean;
}

/** Concurrent kitchen timers (cooking mode + inline step timers), shown by the floating
 *  TimerTrayComponent on every page. When one finishes: toast, vibration, a short beep. */
@Injectable({
  providedIn: 'root'
})
export class TimerService {
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private document = inject(DOCUMENT);
  private timersSignal = signal<CookingTimer[]>([]);
  private nowSignal = signal(Date.now());
  private tick: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private audio: AudioContext | null = null;

  readonly timers = this.timersSignal.asReadonly();
  /** Updated every second while any timer runs (drives the countdown text). */
  readonly now = this.nowSignal.asReadonly();
  readonly active = computed(() => this.timersSignal().filter(t => !t.done));

  start(label: string, minutes: number, context = ''): CookingTimer {
    const durationMs = Math.round(minutes * 60_000);
    const timer: CookingTimer = {
      id: this.nextId++, label, context, durationMs, endsAt: Date.now() + durationMs, pausedRemainingMs: null, done: false,
    };
    this.timersSignal.update(list => [...list, timer]);
    this.unlockAudio();
    this.ensureTicking();
    return timer;
  }

  remaining(timer: CookingTimer): number {
    if (timer.done) return 0;
    return timer.pausedRemainingMs ?? Math.max(0, timer.endsAt - this.nowSignal());
  }

  togglePause(id: number): void {
    this.timersSignal.update(list =>
      list.map(t => {
        if (t.id !== id || t.done) return t;
        return t.pausedRemainingMs === null
          ? { ...t, pausedRemainingMs: Math.max(0, t.endsAt - Date.now()) }
          : { ...t, endsAt: Date.now() + t.pausedRemainingMs, pausedRemainingMs: null };
      })
    );
    this.ensureTicking();
  }

  /** +1 minute. */
  extend(id: number, minutes = 1): void {
    const ms = minutes * 60_000;
    this.timersSignal.update(list =>
      list.map(t =>
        t.id !== id ? t : t.done
          ? { ...t, done: false, endsAt: Date.now() + ms, durationMs: ms }
          : t.pausedRemainingMs !== null ? { ...t, pausedRemainingMs: t.pausedRemainingMs + ms } : { ...t, endsAt: t.endsAt + ms }
      )
    );
    this.ensureTicking();
  }

  dismiss(id: number): void {
    this.timersSignal.update(list => list.filter(t => t.id !== id));
  }

  private ensureTicking(): void {
    if (this.tick !== null) return;
    this.tick = setInterval(() => this.onTick(), 1000);
  }

  private onTick(): void {
    const now = Date.now();
    this.nowSignal.set(now);
    let finished: CookingTimer[] = [];
    this.timersSignal.update(list =>
      list.map(t => {
        if (!t.done && t.pausedRemainingMs === null && t.endsAt <= now) {
          const done = { ...t, done: true };
          finished = [...finished, done];
          return done;
        }
        return t;
      })
    );
    for (const t of finished) this.alert(t);
    if (!this.timersSignal().some(t => !t.done && t.pausedRemainingMs === null)) {
      clearInterval(this.tick!);
      this.tick = null;
    }
  }

  private alert(timer: CookingTimer): void {
    this.toast.show(`${this.i18n.t('timers.finished', { label: timer.label })}${timer.context ? ` - ${timer.context}` : ''}`, 'info', 8000);
    try {
      this.document.defaultView?.navigator.vibrate?.([300, 150, 300, 150, 300]);
    } catch {
      // not supported
    }
    this.beep();
  }

  /** Browsers only allow audio after a user gesture; starting a timer is one. */
  private unlockAudio(): void {
    try {
      const win = this.document.defaultView as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } | null;
      const AudioCtor = win?.AudioContext ?? win?.webkitAudioContext;
      if (!this.audio && AudioCtor) this.audio = new AudioCtor();
      void this.audio?.resume();
    } catch {
      this.audio = null;
    }
  }

  private beep(): void {
    const ctx = this.audio;
    if (!ctx) return;
    try {
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.35);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.35);
        osc.stop(ctx.currentTime + i * 0.35 + 0.25);
      }
    } catch {
      // ignore
    }
  }
}

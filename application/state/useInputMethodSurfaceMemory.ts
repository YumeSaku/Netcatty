import { useEffect } from 'react';

import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';

export const INPUT_METHOD_SURFACE_ATTRIBUTE = 'data-netcatty-input-surface';

export type InputMethodSurface = 'terminal' | 'ai-chat';

type ClosestElement = {
  getAttribute(name: string): string | null;
};

type ClosestTarget = {
  closest(selector: string): ClosestElement | null;
};

export function getInputMethodSurface(target: EventTarget | null): InputMethodSurface | null {
  const closest = (target as unknown as ClosestTarget | null)?.closest;
  if (typeof closest !== 'function') return null;
  const value = closest.call(target, `[${INPUT_METHOD_SURFACE_ATTRIBUTE}]`)
    ?.getAttribute(INPUT_METHOD_SURFACE_ATTRIBUTE);
  return value === 'terminal' || value === 'ai-chat' ? value : null;
}

type SurfaceTrackerOptions = {
  getActiveElement: () => EventTarget | null;
  applySurface: (surface: InputMethodSurface | null) => void;
  schedule: (callback: () => void) => number;
  cancel: (timerId: number) => void;
};

export function createInputMethodSurfaceTracker(options: SurfaceTrackerOptions) {
  let activeSurface: InputMethodSurface | null = null;
  let composingTarget: EventTarget | null = null;
  let scheduledTimer: number | null = null;
  let disposed = false;

  const reconcile = () => {
    scheduledTimer = null;
    if (disposed) return;

    if (composingTarget) return;

    const activeElement = options.getActiveElement();
    const nextSurface = getInputMethodSurface(activeElement);
    if (nextSurface === activeSurface) return;
    activeSurface = nextSurface;
    options.applySurface(nextSurface);
  };

  const scheduleReconcile = () => {
    if (disposed || scheduledTimer !== null) return;
    scheduledTimer = options.schedule(reconcile);
  };

  return {
    focusChanged: scheduleReconcile,
    compositionStarted(target: EventTarget | null) {
      if (getInputMethodSurface(target)) composingTarget = target;
    },
    compositionEnded(target: EventTarget | null) {
      if (target === composingTarget) composingTarget = null;
      scheduleReconcile();
    },
    dispose() {
      disposed = true;
      if (scheduledTimer !== null) options.cancel(scheduledTimer);
      scheduledTimer = null;
    },
  };
}

export function useInputMethodSurfaceMemory(enabled: boolean): void {
  useEffect(() => {
    const bridge = netcattyBridge.get();
    if (!enabled || !bridge?.setInputMethodSurface) {
      if (!enabled) void bridge?.resetInputMethodSurfaceMemory?.();
      return;
    }

    const tracker = createInputMethodSurfaceTracker({
      getActiveElement: () => document.activeElement,
      applySurface: (surface) => {
        void bridge.setInputMethodSurface?.(surface).catch((error) => {
          console.warn('[InputMethod] Failed to update focused surface:', error);
        });
      },
      schedule: (callback) => window.setTimeout(callback, 0),
      cancel: (timerId) => window.clearTimeout(timerId),
    });

    const handleFocusChange = () => tracker.focusChanged();
    const handleCompositionStart = (event: CompositionEvent) => {
      tracker.compositionStarted(event.target);
    };
    const handleCompositionEnd = (event: CompositionEvent) => {
      tracker.compositionEnded(event.target);
    };

    document.addEventListener('focusin', handleFocusChange, true);
    document.addEventListener('focusout', handleFocusChange, true);
    document.addEventListener('compositionstart', handleCompositionStart, true);
    document.addEventListener('compositionend', handleCompositionEnd, true);
    tracker.focusChanged();

    return () => {
      tracker.dispose();
      document.removeEventListener('focusin', handleFocusChange, true);
      document.removeEventListener('focusout', handleFocusChange, true);
      document.removeEventListener('compositionstart', handleCompositionStart, true);
      document.removeEventListener('compositionend', handleCompositionEnd, true);
    };
  }, [enabled]);
}

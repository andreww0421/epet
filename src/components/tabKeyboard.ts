import type { KeyboardEvent } from 'react';

/** Roving focus for horizontal, automatically activated tabs. Only rendered
 * tabs participate; never navigate to a tab hidden for the current role. */
export const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const button = event.currentTarget as HTMLButtonElement;
  const tabs = Array.from(button.parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []);
  const index = tabs.indexOf(button);
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
};

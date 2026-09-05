import { useLayoutEffect, useRef, type ReactNode } from 'react';

type ModalDialogProps = {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
};

/** Mount only while open. Native modality makes the background inert, including
 * for assistive technology, and returns focus to the invoking control on close. */
export const ModalDialog = ({
  children, labelledBy, describedBy, onClose, closeDisabled = false, className = '',
}: ModalDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (!dialog) return;
    const invoker = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog: HTMLDialogElement | null = dialogRef.current;
        if (!dialog) return;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, [tabindex]',
        )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') &&
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0];
        const last = controls[controls.length - 1];
        // Native modality blocks the page behind the dialog; explicitly wrap
        // the ends so keyboard users do not fall out into browser chrome.
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border-0 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 ${className}`}
    >
      {children}
    </dialog>
  );
};

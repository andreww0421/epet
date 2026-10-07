import { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { ModalDialog } from '../ModalDialog';

type DeleteConfirmationDialogProps = {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

/** Shared destructive-action confirmation with labelled dialog semantics. */
export const DeleteConfirmationDialog = ({
  cancelLabel,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: DeleteConfirmationDialogProps) => {
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onCancel}
      className="max-w-sm"
    >
      <div className="p-6">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <h2 id={titleId} className="mb-2 text-center text-lg font-bold text-slate-900">{title}</h2>
        <p id={descriptionId} className="mb-4 text-center text-sm text-slate-600">{message}</p>
      </div>
      <div className="flex justify-end space-x-3 bg-slate-50 px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          {confirmLabel}
        </button>
      </div>
    </ModalDialog>
  );
};

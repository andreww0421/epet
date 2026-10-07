import { useEffect, useState } from 'react';
import { ModalDialog } from '../../../components/ModalDialog';
import { translations } from '../../../i18n/translations';

type DashboardCopy = (typeof translations)[keyof typeof translations];

type AddClassDialogProps = {
  open: boolean;
  onAdd: (name: string) => void;
  onClose: () => void;
  tLang: DashboardCopy;
};

/** Collects and validates a class name before enrollment state is mutated. */
export const AddClassDialog = ({
  open,
  onAdd,
  onClose,
  tLang,
}: AddClassDialogProps) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  if (!open) return null;
  const submit = () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    onAdd(normalizedName);
  };

  return (
    <ModalDialog labelledBy="add-class-title" onClose={onClose} className="max-w-sm">
      <div className="p-6">
        <h2 id="add-class-title" className="mb-4 text-lg font-bold text-slate-900">{tLang.addClass}</h2>
        <label htmlFor="className" className="mb-1 block text-sm font-medium text-slate-700">
          {tLang.className}
        </label>
        <input
          id="className"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          className="w-full rounded-md border border-slate-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder={tLang.enterClassName}
          autoFocus
        />
      </div>
      <div className="flex justify-end space-x-3 bg-slate-50 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {tLang.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          {tLang.add}
        </button>
      </div>
    </ModalDialog>
  );
};

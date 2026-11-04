import { BarChart3 } from 'lucide-react';
import { handleTabKeyDown } from '../../../components/tabKeyboard';
import type { Language } from '../../../store/types';
import type { ConsoleDestination, getAreaAnalysisDestinations } from '../model/navigation';

type Props = {
  active: ConsoleDestination;
  language: Language;
  destinations: ReturnType<typeof getAreaAnalysisDestinations>;
  onChange: (destination: ConsoleDestination) => void;
};

/** Visually contextual links remain direct-child tabs in the same keyboard group. */
export const WorkflowAnalysisLinks = ({ active, language, destinations, onChange }: Props) => {
  if (destinations.length === 0) return null;
  return <>
    <span aria-hidden="true" className="mt-1 basis-full border-t border-slate-200 pt-3 text-xs font-semibold text-slate-500">
      {language === 'en' ? 'Analysis for this workflow' : '分析入口'}
    </span>
    {destinations.map((item) => (
      <button key={item.id} id={`console-tab-${item.id}`} type="button" role="tab"
        aria-selected={active === item.id} aria-controls="dashboard-panel" tabIndex={active === item.id ? 0 : -1}
        onKeyDown={handleTabKeyDown} onClick={() => onChange(item.id)}
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 ${active === item.id ? 'border-indigo-300 bg-indigo-50 text-indigo-900 shadow-sm' : 'border-transparent text-indigo-700 hover:border-indigo-200 hover:bg-white'}`}>
        <BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label[language]}
      </button>
    ))}
  </>;
};

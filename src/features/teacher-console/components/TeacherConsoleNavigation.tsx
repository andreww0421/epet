import { BookOpen, CalendarDays, Gamepad2, Settings, Users } from 'lucide-react';
import { handleTabKeyDown } from '../../../components/tabKeyboard';
import type { Language } from '../../../store/types';
import {
  PRIMARY_AREAS, getAreaAnalysisDestinations, getAreaDestinations, getAreaLabel, getAreaTaskDestinations, getDestination,
  type ConsoleArea, type ConsoleCapabilities, type ConsoleDestination,
} from '../model/navigation';
import { WorkflowAnalysisLinks } from './WorkflowAnalysisLinks';

const icons = { today: CalendarDays, class: Users, learning: BookOpen, activities: Gamepad2, settings: Settings };
type Props = ConsoleCapabilities & {
  active: ConsoleDestination;
  language: Language;
  onAreaChange: (area: ConsoleArea) => void;
  onChange: (destination: ConsoleDestination) => void;
  gamificationVisible?: boolean;
};

/** Two flat levels: daily work areas, then their task tabs. Settings stays secondary. */
export const TeacherConsoleNavigation = ({ active, language, onAreaChange, onChange, gamificationVisible = true, ...capabilities }: Props) => {
  const area = getDestination(active).area;
  const destinations = getAreaTaskDestinations(area, capabilities);
  const analyses = getAreaAnalysisDestinations(area, capabilities);
  const visibleAreas = PRIMARY_AREAS.filter((item) => (gamificationVisible || item !== 'activities') && getAreaDestinations(item, capabilities).length > 0);
  return (
    <div className="mb-6">
      <nav aria-label="Teacher Console" className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:flex sm:items-stretch sm:gap-2">
        <div className={`grid flex-1 gap-1 ${visibleAreas.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {visibleAreas.map((item) => {
            const Icon = icons[item];
            return (
              <button key={item} id={`console-area-${item}`} type="button" onClick={() => onAreaChange(item)}
                disabled={getAreaDestinations(item, capabilities).length === 0}
                aria-current={item === area ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 sm:flex-row sm:gap-2 sm:text-sm ${item === area ? 'bg-indigo-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'}`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full break-words leading-5">{getAreaLabel(item, language)}</span>
              </button>
            );
          })}
        </div>
        {!capabilities.readOnly && capabilities.canAdministerWorkspace && (
          <div className="mt-2 flex justify-end border-t border-slate-100 pt-2 sm:mt-0 sm:items-center sm:border-t-0 sm:border-l sm:pl-2 sm:pt-0">
            <button id="console-area-settings" type="button" onClick={() => onAreaChange('settings')}
              aria-current={area === 'settings' ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 ${area === 'settings' ? 'bg-indigo-100 text-indigo-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Settings className="h-4 w-4" aria-hidden="true" />{getAreaLabel('settings', language)}
            </button>
          </div>
        )}
      </nav>
      {area !== 'today' && (
        <div role="tablist" aria-label={`${getAreaLabel(area, language)}${language === 'en' ? ' tools' : '工具'}`} className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {destinations.map((item) => (
            <button key={item.id} id={`console-tab-${item.id}`} type="button" role="tab" aria-selected={active === item.id}
              aria-controls="dashboard-panel" tabIndex={active === item.id ? 0 : -1}
              onKeyDown={handleTabKeyDown} onClick={() => onChange(item.id)}
              className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 ${active === item.id ? 'border-indigo-300 bg-indigo-50 text-indigo-900 shadow-sm' : 'border-transparent text-slate-600 hover:bg-white hover:text-slate-900'}`}>
              {item.label[language]}
            </button>
          ))}
          <WorkflowAnalysisLinks active={active} language={language} destinations={analyses} onChange={onChange} />
        </div>
      )}
    </div>
  );
};

import { BarChart3, BookOpen, Crosshair, Gift, Settings, Shield, Users } from 'lucide-react';
import { handleTabKeyDown } from '../tabKeyboard';
import { translations } from '../../i18n/translations';
import type { Language } from '../../store/types';

export type DashboardSection =
  | 'students'
  | 'rewards'
  | 'activities'
  | 'analytics'
  | 'rules'
  | 'records'
  | 'governance';

type DashboardTabsProps = {
  activeSection: DashboardSection;
  canAdministerWorkspace: boolean;
  language: Language;
  onChange: (section: DashboardSection) => void;
  readOnly: boolean;
};

/** Accessible dashboard navigation; feature panels stay unaware of tab mechanics. */
export const DashboardTabs = ({
  activeSection,
  canAdministerWorkspace,
  language,
  onChange,
  readOnly,
}: DashboardTabsProps) => {
  const copy = translations[language];
  const tabs = [
    ['students', copy.dashboardTabStudents, Users],
    ['rewards', copy.dashboardTabRewards, Gift],
    ['activities', copy.dashboardTabActivities, Crosshair],
    ['analytics', copy.dashboardTabAnalytics, BarChart3],
    ['rules', copy.dashboardTabRules, Settings],
    ['records', copy.dashboardTabRecords, BookOpen],
    ['governance', language === 'en' ? 'Data governance' : '資料治理', Shield],
  ] as const;

  return (
    <div
      className="mb-6 grid grid-cols-2 gap-1 border-b border-slate-200 sm:flex"
      role="tablist"
      aria-label={copy.dashboard}
    >
      {tabs
        .filter(([section]) => {
          if (readOnly) return section === 'analytics' || section === 'records';
          return canAdministerWorkspace || (section !== 'rules' && section !== 'governance');
        })
        .map(([section, label, Icon]) => (
          <button
            key={section}
            type="button"
            role="tab"
            id={`dashboard-tab-${section}`}
            aria-selected={activeSection === section}
            aria-controls="dashboard-panel"
            tabIndex={activeSection === section ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => onChange(section)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 border-b-2 px-4 py-2 text-sm font-bold transition-colors ${
              activeSection === section
                ? 'border-indigo-600 bg-white text-indigo-700'
                : 'border-transparent text-slate-500 hover:bg-white hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
    </div>
  );
};

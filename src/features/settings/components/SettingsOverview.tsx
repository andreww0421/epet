import { Shield } from 'lucide-react';
import type { PetCareMode, PublicLeaderboardMode, PublicNameMode } from '../../../store/types';
import type { DashboardSettingsModel } from '../hooks/useDashboardSettings';

type SettingsOverviewProps = {
  model: DashboardSettingsModel;
  mode?: 'rules' | 'governance' | 'all';
};

/** Presets, impact preview, and education-safety/privacy controls. */
export const SettingsOverview = ({ model, mode = 'all' }: SettingsOverviewProps) => {
  const { actions, context, preview, privacy } = model;
  const { copy, currentStudents, lang } = context;

  return (
    <>
      <div hidden={mode === 'governance'}>
        <div className="mb-6 grid gap-5 border-y border-slate-200 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{copy.settingsPresets}</h3>
            <p className="mt-1 text-xs text-slate-500">{copy.settingsPresetsHint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ['lowCompetition', copy.presetLowCompetition],
                ['cooperative', copy.presetCooperative],
                ['shortCampaign', copy.presetShortCampaign],
              ].map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => actions.applySettingsPreset(
                    preset as 'lowCompetition' | 'cooperative' | 'shortCampaign',
                    label,
                  )}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{copy.settingsImpact}</h3>
            <div className="mt-3 grid grid-cols-2 gap-px bg-slate-200">
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{copy.currentAverageFullness}</p>
                <p className="mt-1 text-xl font-black text-slate-800">
                  {currentStudents.length > 0 ? `${preview.currentAverageFullness}%` : '-'}
                </p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{copy.projectedWeeklyFullness}</p>
                <p className="mt-1 text-xl font-black text-rose-700">
                  {currentStudents.length > 0 ? `${preview.projectedAverageFullness}%` : '-'}
                </p>
                {currentStudents.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {copy.sevenDayDecayTotal.replace('{value}', preview.sevenDayDecay.toString())}
                  </p>
                )}
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{copy.upgradePositiveActions}</p>
                <p className="mt-1 text-xl font-black text-emerald-700">
                  {currentStudents.length > 0 ? preview.estimatedUpgradeActions : '-'}
                </p>
              </div>
              <div className="bg-white p-3">
                <p className="text-xs text-slate-500">{copy.estimatedUpgradeDays}</p>
                <p className="mt-1 text-xl font-black text-indigo-700">
                  {currentStudents.length > 0
                    ? copy.daysValue.replace('{value}', preview.estimatedUpgradeDays.toString())
                    : '-'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{copy.settingsImpactHint}</p>
          </div>
        </div>
      </div>

      <div className="mb-6 border-y border-slate-200 py-5">
        <div>
          <h3 className="flex items-center text-sm font-bold text-slate-800">
            <Shield className="mr-2 h-4 w-4 text-emerald-600" />
            {mode === 'governance'
              ? lang === 'en' ? 'Student Visibility & Privacy' : '學生顯示與隱私'
              : copy.educationSafetySettings}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {mode === 'governance'
              ? lang === 'en'
                ? 'Control which student names and rankings appear in the classroom display.'
                : '管理展示大廳顯示的學生姓名與排行榜資訊。'
              : copy.educationSafetyHint}
          </p>
        </div>
        <div hidden={mode === 'governance'}>
          <div className="mt-4 flex items-start justify-between gap-4 border-l-4 border-emerald-400 bg-emerald-50 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-emerald-950">{copy.inclusiveMode}</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-emerald-800">{copy.inclusiveModeHint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={privacy.inclusiveMode}
              aria-label={copy.inclusiveMode}
              onClick={actions.toggleInclusiveMode}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center justify-start rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${privacy.inclusiveMode ? 'bg-emerald-600' : 'bg-slate-300'}`}
            >
              <span className={`block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${privacy.inclusiveMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        {privacy.inclusiveMode && (
          <p className="mt-2 text-xs font-medium text-emerald-700">{copy.inclusiveModeLockedHint}</p>
        )}
        <fieldset
          disabled={privacy.inclusiveMode}
          className={`mt-4 grid gap-4 transition-opacity md:grid-cols-2 ${mode === 'all' ? 'xl:grid-cols-4' : ''} ${privacy.inclusiveMode ? 'opacity-50' : ''}`}
        >
          <div hidden={mode === 'rules'}>
            <div className="flex flex-col gap-1">
              <label htmlFor="publicNameMode" className="text-sm font-medium text-slate-700">{copy.publicNameMode}</label>
              <select id="publicNameMode" value={privacy.publicNameMode} onChange={(event) => privacy.setPublicNameMode(event.target.value as PublicNameMode)} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500">
                <option value="masked">{copy.publicNameMasked}</option>
                <option value="full">{copy.publicNameFull}</option>
              </select>
              <p className="text-xs text-slate-500">{copy.publicNameHint}</p>
            </div>
          </div>
          <div hidden={mode === 'rules'}>
            <div className="flex flex-col gap-1">
              <label htmlFor="publicLeaderboardMode" className="text-sm font-medium text-slate-700">{copy.publicLeaderboardMode}</label>
              <select id="publicLeaderboardMode" value={privacy.publicLeaderboardMode} onChange={(event) => privacy.setPublicLeaderboardMode(event.target.value as PublicLeaderboardMode)} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500">
                <option value="growth">{copy.leaderboardGrowth}</option>
                <option value="rank">{copy.leaderboardRank}</option>
                <option value="hidden">{copy.leaderboardHidden}</option>
              </select>
            </div>
          </div>
          <div hidden={mode === 'governance'}>
            <div className="flex flex-col gap-1">
              <label htmlFor="petCareMode" className="text-sm font-medium text-slate-700">{copy.petCareMode}</label>
              <select id="petCareMode" value={privacy.petCareModeDraft} onChange={(event) => privacy.onPetCareModeDraftChange(event.target.value as PetCareMode)} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500">
                <option value="rest">{copy.petCareRest}</option>
                <option value="death">{copy.petCareDeath}</option>
              </select>
              <p className="text-xs text-slate-500">{privacy.petCareModeDraft === 'rest' ? copy.petCareRestHint : copy.petCareDeathHint}</p>
            </div>
          </div>
          <div hidden={mode === 'governance'}>
            <label className="flex h-full min-h-[84px] cursor-pointer items-start gap-3 border-l-4 border-emerald-300 bg-emerald-50 p-3">
              <input type="checkbox" checked={privacy.pauseDecayOnWeekends} onChange={(event) => privacy.setPauseDecayOnWeekends(event.target.checked)} className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500" />
              <span>
                <span className="block text-sm font-bold text-emerald-950">{copy.pauseDecayOnWeekends}</span>
                <span className="mt-1 block text-xs text-emerald-800">{copy.pauseDecayOnWeekendsHint}</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
    </>
  );
};

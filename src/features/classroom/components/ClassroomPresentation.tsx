import React, { useId, useMemo, useState } from 'react';
import { Heart, Sparkles, Trophy } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { petNames } from '../../../i18n/translations';
import { PET_TYPES } from '../../../store/constants';
import { useStore } from '../../../store/useStore';
import {
  buildClassroomPresentation,
  type ClassroomPresentationModel,
  type ClassroomPresentationOptions,
  type ClassroomPresentationStudent,
} from '../model/classroomPresentation';

const PublicPetCard: React.FC<{
  student: ClassroomPresentationStudent;
  language: ClassroomPresentationModel['language'];
}> = ({ student, language }) => {
  const headingId = useId();
  // Resolve only known catalogue entries. Unknown persisted strings never
  // become labels, titles, class names or accessibility attributes.
  const pet = PET_TYPES.find((entry) => entry.id === student.petType) ?? PET_TYPES[0];
  const PetIcon = pet.icon;
  const petLabel = petNames[language][student.petType] ?? petNames[language].egg;
  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3">
        <h3 id={headingId} className="min-w-0 break-words text-lg font-bold text-slate-900">{student.displayName}</h3>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-sm font-bold tabular-nums text-amber-900">Lv. {student.level}</span>
      </header>
      <div className="flex min-h-44 flex-col items-center justify-center gap-4 bg-gradient-to-b from-white to-amber-50 px-6 py-6">
        <PetIcon className="h-20 w-20 text-amber-700" aria-hidden="true" />
        <p className="text-base font-semibold text-slate-700">{petLabel}</p>
      </div>
    </article>
  );
};

/** Pure DTO rendering: there are no stored records or mutation callbacks here. */
export const ClassroomPresentationContent = ({ model }: { model: ClassroomPresentationModel }) => {
  const [view, setView] = useState<'gallery' | 'leaderboard'>('gallery');
  const galleryId = useId();
  const leaderboardId = useId();
  const bossId = useId();
  const zh = model.language === 'zh';
  const leaderboardVisible = model.leaderboard.mode !== 'hidden';
  const activeView = leaderboardVisible ? view : 'gallery';
  const ranked = model.leaderboard.mode === 'rank';
  const leaderboardLabel = ranked ? (zh ? '遊戲排行榜' : 'Game leaderboard')
    : (zh ? '包容性排行榜' : 'Inclusive leaderboard');

  return (
    <section aria-label={zh ? '投影內容' : 'Presentation content'} className="min-h-full bg-amber-50/50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-amber-900">{zh ? '寵物展示大廳' : 'Pet Exhibition Hall'}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-6 text-amber-800">{zh ? '一起欣賞每位同學的寵物與成長。' : "Celebrate everyone's pets and growth together."}</p>
          <nav aria-label={zh ? '展示檢視' : 'Display views'} className="mt-5 flex flex-wrap justify-center gap-3">
            <button type="button" aria-pressed={activeView === 'gallery'} onClick={() => setView('gallery')}
              className={`min-h-11 rounded-full border border-amber-300 px-4 py-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-800 ${activeView === 'gallery' ? 'bg-amber-800 text-white' : 'bg-white text-amber-900 hover:bg-amber-100'}`}>
              {zh ? '寵物展示' : 'Pet gallery'}
            </button>
            {leaderboardVisible && <button type="button" aria-pressed={activeView === 'leaderboard'} onClick={() => setView('leaderboard')}
              className={`min-h-11 rounded-full border border-amber-300 px-4 py-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-800 ${activeView === 'leaderboard' ? 'bg-amber-800 text-white' : 'bg-white text-amber-900 hover:bg-amber-100'}`}>
              {leaderboardLabel}
            </button>}
          </nav>
        </header>

        {model.boss && <section aria-labelledby={bossId} className="rounded-xl border border-slate-700 bg-slate-900 p-5 text-white">
          <h2 id={bossId} className="flex items-center gap-2 text-xl font-bold"><Heart className="h-5 w-5 text-rose-300" aria-hidden="true" />{zh ? '魔王活動' : 'Boss activity'}</h2>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm font-semibold"><span>{zh ? '魔王生命值' : 'Boss health'}</span><span className="tabular-nums">{model.boss.hp} / {model.boss.maxHp}</span></div>
          <div role="progressbar" aria-label={zh ? '魔王生命值' : 'Boss health'} aria-valuemin={0} aria-valuemax={model.boss.maxHp} aria-valuenow={model.boss.hp} className="mt-2 h-4 overflow-hidden rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-rose-400" style={{ width: `${(model.boss.hp / model.boss.maxHp) * 100}%` }} />
          </div>
        </section>}

        {activeView === 'gallery' ? <section aria-labelledby={galleryId}>
          <h2 id={galleryId} className="mb-4 text-xl font-bold text-amber-950">{zh ? '寵物展示' : 'Pet gallery'}</h2>
          {model.students.length === 0 ? <p className="rounded-xl border border-dashed border-amber-300 bg-white p-8 text-center text-slate-600">{zh ? '目前還沒有寵物可以展示。' : 'There are no pets to display yet.'}</p>
            : <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{model.students.map((student, index) => <PublicPetCard key={index} student={student} language={model.language} />)}</div>}
        </section> : <section aria-labelledby={leaderboardId} className="rounded-xl border border-amber-200 bg-white p-4 sm:p-5">
          <h2 id={leaderboardId} className="flex items-center gap-2 text-xl font-bold text-amber-950"><Trophy className="h-5 w-5 text-amber-700" aria-hidden="true" />{leaderboardLabel}</h2>
          {!ranked && <p className="mt-2 text-sm leading-6 text-slate-700">{zh ? '每一位同學都在這裡，依班級名單順序展示；不依分數或學習表現排序。' : 'Everyone is included in class roster order, without scoring or learning comparisons.'}</p>}
          {model.leaderboard.students.length === 0 ? <p className="mt-4 text-sm text-slate-600">{zh ? '目前還沒有寵物可以展示。' : 'There are no pets to display yet.'}</p>
            : ranked ? <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-amber-200 text-slate-600"><th scope="col" className="px-3 py-3">{zh ? '名次' : 'Rank'}</th><th scope="col" className="px-3 py-3">{zh ? '學生' : 'Learner'}</th><th scope="col" className="px-3 py-3">{zh ? '寵物等級' : 'Pet level'}</th><th scope="col" className="px-3 py-3">RP</th></tr></thead>
                <tbody>{model.leaderboard.students.map((student, index) => <tr key={index} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-bold tabular-nums text-amber-900">{index + 1}</td><th scope="row" className="break-words px-3 py-3 font-semibold text-slate-900">{student.displayName}</th><td className="px-3 py-3 tabular-nums text-slate-700">Lv. {student.level}</td><td className="px-3 py-3 font-semibold tabular-nums text-slate-700">{student.rankPoints ?? 0}</td></tr>)}</tbody>
              </table>
            </div> : <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{model.leaderboard.students.map((student, index) => <li key={index} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><Sparkles className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" /><div className="min-w-0"><p className="break-words text-base font-bold text-slate-900">{student.displayName}</p><p className="mt-1 text-sm text-emerald-900">{petNames[model.language][student.petType] ?? petNames[model.language].egg} · Lv. {student.level}</p></div></li>)}</ul>}
        </section>}
      </div>
    </section>
  );
};

/** Projects current-class state once before it reaches the read-only display. */
export const ClassroomPresentation = ({ options }: { options: ClassroomPresentationOptions }) => {
  const { currentClass, settings } = useStore(useShallow((state) => ({
    currentClass: state.data.classes.find((classData) => classData.id === state.data.currentClassId),
    settings: state.data.settings,
  })));
  const model = useMemo(() => buildClassroomPresentation(currentClass, settings, options),
    [currentClass, settings, options.maskNames, options.inclusiveLeaderboard]);
  return <ClassroomPresentationContent model={model} />;
};

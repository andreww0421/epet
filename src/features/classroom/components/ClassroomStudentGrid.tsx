import React, { useId, useMemo, useRef, useState } from 'react';
import { Dog } from 'lucide-react';
import type { Language, Student } from '../../../store/types';
import type { ClassroomTranslations, GetClassroomRankInfo } from '../types';
import { ClassroomStudentCard } from './ClassroomStudentCard';

type ClassroomStudentGridProps = {
  students: Student[];
  translations: ClassroomTranslations;
  language?: Language;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
  getRankInfo: GetClassroomRankInfo;
};

export const ClassroomStudentGrid: React.FC<ClassroomStudentGridProps> = ({
  students,
  translations: tLang,
  language = 'zh',
  onBattle,
  onTeamUp,
  getRankInfo,
}) => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const searchId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase();
  const filtered = useMemo(() => normalizedQuery
    ? students.filter((student) => student.name.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery))
    : students, [students, normalizedQuery]);
  // Bound mounted cards, not the roster. Battle/team dialogs still receive the
  // complete authorized class, and no persisted record is truncated or reordered.
  const pageSize = 24;
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const visibleStudents = filtered.slice(start, start + pageSize);
  const movePage = (next: number) => {
    setPage(next);
    requestAnimationFrame(() => heading.current?.focus());
  };
  if (students.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-2xl shadow-sm border-2 border-amber-100">
        <Dog className="h-16 w-16 text-amber-300 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-amber-900">{tLang.noPets}</h2>
        <p className="text-amber-700 mt-1">{tLang.addStudentFirst}</p>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${searchId}-heading`}>
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 ref={heading} id={`${searchId}-heading`} tabIndex={-1} className="font-bold text-slate-900">{language === 'en' ? 'Class pet roster' : '班級寵物列表'}</h2>
          <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 text-sm text-slate-600">
            {language === 'en'
              ? `Showing ${filtered.length ? start + 1 : 0}–${start + visibleStudents.length} of ${filtered.length} · Class total ${students.length}`
              : `顯示 ${filtered.length ? start + 1 : 0}–${start + visibleStudents.length} 位，共 ${filtered.length} 位；全班 ${students.length} 位`}
          </p>
        </div>
        <label htmlFor={searchId} className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-slate-700 sm:w-64">
          {language === 'en' ? 'Find a student in this class' : '搜尋此班學生'}
          <input id={searchId} type="search" value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
      </div>
      {filtered.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-slate-700">{language === 'en' ? 'No matching student. Try another name.' : '找不到符合的學生，請嘗試其他姓名。'}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {visibleStudents.map((student) => (
        <ClassroomStudentCard
          key={student.id}
          studentId={student.id}
          onBattle={onBattle}
          onTeamUp={onTeamUp}
          getRankInfo={getRankInfo}
        />
      ))}
      </div>
      {lastPage > 0 && <nav aria-label={language === 'en' ? 'Pet roster pages' : '寵物列表分頁'} className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" disabled={currentPage === 0} onClick={() => movePage(currentPage - 1)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 disabled:opacity-50">{language === 'en' ? 'Previous page' : '上一頁'}</button>
        <span className="text-sm tabular-nums text-slate-700">{language === 'en' ? `Page ${currentPage + 1} of ${lastPage + 1}` : `第 ${currentPage + 1}／${lastPage + 1} 頁`}</span>
        <button type="button" disabled={currentPage === lastPage} onClick={() => movePage(currentPage + 1)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 disabled:opacity-50">{language === 'en' ? 'Next page' : '下一頁'}</button>
      </nav>}
    </section>
  );
};

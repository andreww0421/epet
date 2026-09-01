import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, ShieldCheck, X } from 'lucide-react';
import type { Student } from '../../store/types';
import { getDateKey } from '../../gameRules';

type DailyTaskCalendarSettingsProps = {
  lang: 'zh' | 'en';
  classes: Array<{ id: string; name: string }>;
  selectedClassId: string;
  onClassChange: (classId: string) => void;
  timeZone: string;
  onTimeZoneChange: (value: string) => void;
  schoolWeekdays: number[];
  onSchoolWeekdaysChange: (value: number[]) => void;
  holidayDatesText: string;
  onHolidayDatesTextChange: (value: string) => void;
  makeupWindowDays: number;
  onMakeupWindowDaysChange: (value: number) => void;
  students: Student[];
  onSetExcusedDate: (studentId: string, date: string, excused: boolean) => void;
  onSave: () => void;
};

const WEEKDAYS = [
  { value: 1, zh: '一', en: 'Mon' },
  { value: 2, zh: '二', en: 'Tue' },
  { value: 3, zh: '三', en: 'Wed' },
  { value: 4, zh: '四', en: 'Thu' },
  { value: 5, zh: '五', en: 'Fri' },
  { value: 6, zh: '六', en: 'Sat' },
  { value: 0, zh: '日', en: 'Sun' },
] as const;

export const DailyTaskCalendarSettings: React.FC<DailyTaskCalendarSettingsProps> = ({
  lang,
  classes,
  selectedClassId,
  onClassChange,
  timeZone,
  onTimeZoneChange,
  schoolWeekdays,
  onSchoolWeekdaysChange,
  holidayDatesText,
  onHolidayDatesTextChange,
  makeupWindowDays,
  onMakeupWindowDaysChange,
  students,
  onSetExcusedDate,
  onSave,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState(students[0]?.id ?? '');
  const [excusedDate, setExcusedDate] = useState(() => getDateKey(Date.now(), timeZone));
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId),
    [selectedStudentId, students],
  );

  useEffect(() => {
    if (!students.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(students[0]?.id ?? '');
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    setExcusedDate(getDateKey(Date.now(), timeZone));
  }, [selectedClassId, timeZone]);

  const copy = lang === 'en'
    ? {
        title: 'Daily Task Calendar',
        hint: 'Each class has its own schedule. Weekends, holidays, and approved leave never break a streak.',
        classroom: 'Class to configure',
        scope: 'Changes apply only to this class. Save before switching classes.',
        save: 'Save this class calendar',
        timeZone: 'Class timezone',
        weekdays: 'Teaching days',
        holidays: 'Class cancellations / holidays',
        holidaysHint: 'Enter one YYYY-MM-DD date per line. These dates freeze the streak for the whole class.',
        makeup: 'Make-up window (days)',
        makeupHint: 'Missed teaching days can be completed in order within this window. Set 0 to disable make-ups.',
        leave: 'Approved student leave',
        student: 'Student',
        date: 'Leave date',
        add: 'Add leave date',
        empty: 'No approved leave dates.',
        noStudents: 'Add a student before recording approved leave.',
        audit: 'Make-up claims are recorded with both the completion time and effective school date.',
      }
    : {
        title: '每日任務校曆',
        hint: '每個班級可設定自己的上課日；週末、停課日及核准請假不會中斷連續紀錄。',
        classroom: '要設定的班級',
        scope: '變更只會套用到這個班級；切換班級前請先儲存。',
        save: '儲存此班校曆',
        timeZone: '班級時區',
        weekdays: '固定上課日',
        holidays: '本班停課／假日',
        holidaysHint: '每行輸入一個 YYYY-MM-DD；這些日期會為全班凍結連續紀錄。',
        makeup: '可補簽天數',
        makeupHint: '缺漏的上課日會依序補簽；設為 0 即關閉跨日補簽。',
        leave: '學生核准請假',
        student: '學生',
        date: '請假日期',
        add: '加入請假日',
        empty: '目前沒有核准請假日。',
        noStudents: '請先新增學生，才能登記核准請假。',
        audit: '補簽紀錄會同時保留完成時間與生效上課日，便於稽核。',
      };

  const toggleWeekday = (weekday: number) => {
    const checked = schoolWeekdays.includes(weekday);
    if (checked && schoolWeekdays.length === 1) return;
    onSchoolWeekdaysChange(
      checked
        ? schoolWeekdays.filter((day) => day !== weekday)
        : [...schoolWeekdays, weekday].sort((left, right) => left - right),
    );
  };

  const excusedDates = selectedStudent?.dailyProgress?.excusedDates ?? [];

  return (
    <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-labelledby="daily-task-calendar-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <span className="shrink-0 rounded-lg bg-amber-100 p-2 text-amber-800">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h4 id="daily-task-calendar-title" className="font-bold text-slate-900">{copy.title}</h4>
            <p className="mt-1 text-sm text-slate-600">{copy.hint}</p>
          </div>
        </div>
        <div className="sm:ml-auto sm:w-64">
          <label className="flex flex-col gap-1 text-xs font-bold text-amber-950">
            {copy.classroom}
            <select
              value={selectedClassId}
              onChange={(event) => onClassChange(event.target.value)}
              className="rounded-md border border-amber-300 bg-white p-2 text-sm font-medium text-slate-800 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              {classes.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>{classroom.name}</option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs text-amber-800">{copy.scope}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {copy.timeZone}
          <input
            aria-label={copy.timeZone}
            list="school-time-zone-options"
            value={timeZone}
            onChange={(event) => onTimeZoneChange(event.target.value)}
            className="rounded-md border border-slate-300 bg-white p-2 font-normal shadow-sm focus:border-amber-500 focus:ring-amber-500"
          />
          <datalist id="school-time-zone-options">
            <option value="Asia/Taipei" />
            <option value="Asia/Tokyo" />
            <option value="Asia/Hong_Kong" />
            <option value="Asia/Singapore" />
            <option value="UTC" />
          </datalist>
        </label>

        <fieldset className="lg:col-span-2">
          <legend className="text-sm font-medium text-slate-700">{copy.weekdays}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map((weekday) => {
              const checked = schoolWeekdays.includes(weekday.value);
              return (
                <label
                  key={weekday.value}
                  className={`cursor-pointer rounded-md border px-3 py-2 text-xs font-bold transition-colors ${
                    checked
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-slate-300 bg-white text-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && schoolWeekdays.length === 1}
                    onChange={() => toggleWeekday(weekday.value)}
                    className="sr-only"
                  />
                  {lang === 'en' ? weekday.en : `週${weekday.zh}`}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
          {copy.holidays}
          <textarea
            rows={4}
            value={holidayDatesText}
            onChange={(event) => onHolidayDatesTextChange(event.target.value)}
            placeholder={'2026-09-28\n2026-10-10'}
            className="rounded-md border border-slate-300 bg-white p-2 font-mono text-sm font-normal shadow-sm focus:border-amber-500 focus:ring-amber-500"
          />
          <span className="text-xs font-normal text-slate-500">{copy.holidaysHint}</span>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {copy.makeup}
          <input
            type="number"
            min={0}
            max={30}
            value={makeupWindowDays}
            onChange={(event) => onMakeupWindowDaysChange(Number(event.target.value))}
            className="rounded-md border border-slate-300 bg-white p-2 font-normal shadow-sm focus:border-amber-500 focus:ring-amber-500"
          />
          <span className="text-xs font-normal text-slate-500">{copy.makeupHint}</span>
        </label>
      </div>

      <div className="mt-5 border-t border-amber-200 pt-4">
        <h5 className="text-sm font-bold text-slate-800">{copy.leave}</h5>
        {students.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{copy.noStudents}</p>
        ) : (
          <>
            <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {copy.student}
                <select
                  value={selectedStudentId}
                  onChange={(event) => setSelectedStudentId(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-800"
                >
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>{student.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {copy.date}
                <input
                  type="date"
                  value={excusedDate}
                  onChange={(event) => setExcusedDate(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-800"
                />
              </label>
              <button
                type="button"
                disabled={!selectedStudentId || !excusedDate || excusedDates.includes(excusedDate)}
                onClick={() => onSetExcusedDate(selectedStudentId, excusedDate, true)}
                className="inline-flex items-center justify-center rounded-md bg-amber-700 px-3 py-2 text-sm font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                {copy.add}
              </button>
            </div>
            <div className="mt-3 flex min-h-8 flex-wrap gap-2">
              {excusedDates.length === 0 ? (
                <span className="text-xs text-slate-500">{copy.empty}</span>
              ) : excusedDates.map((date) => (
                <span key={date} className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-amber-200">
                  {date}
                  <button
                    type="button"
                    aria-label={`${lang === 'en' ? 'Remove' : '移除'} ${date}`}
                    onClick={() => onSetExcusedDate(selectedStudentId, date, false)}
                    className="ml-2 text-slate-400 hover:text-rose-600"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mt-4 flex items-center gap-2 rounded-md bg-white/80 px-3 py-2 text-xs font-medium text-amber-900">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        {copy.audit}
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={!selectedClassId}
          className="inline-flex items-center justify-center rounded-md bg-amber-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          {copy.save}
        </button>
      </div>
    </section>
  );
};

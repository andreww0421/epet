import React, { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FileClock, LockKeyhole } from 'lucide-react';
import { translations } from '../../../i18n/translations';
import { formatExamDelta, formatExamPercent } from '../../exams/model/examDraft';
import { getCompetencyLabels } from '../../learning/model/getCompetencyLabels';
import type { ClassData, Language } from '../../../store/types';
import {
  getArchivedClassHistory,
  getArchivedExamAnalyses,
  type ArchivedStudentHistoryEntry,
} from '../model/classArchiveHistory';

type ArchivedClassHistoryPanelProps = { classroom: ClassData; language: Language };

const archiveTimeIso = (timestamp: number) => {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const formatArchiveTime = (timestamp: number, language: Language) => archiveTimeIso(timestamp)
  ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-TW' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(timestamp)
  : language === 'zh' ? '日期未記錄' : 'Date not recorded';

const HistoryActivity: React.FC<{ entry: ArchivedStudentHistoryEntry; language: Language }> = ({ entry, language }) => {
  const zh = language === 'zh';
  const competencyLabels = getCompetencyLabels(language);
  const copy = translations[language];
  let content: ReactNode;
  switch (entry.kind) {
    case 'points':
      content = <>{zh ? '點數變更' : 'Point change'}: {entry.record.amount > 0 ? '+' : ''}{entry.record.amount}
        {entry.record.reasonLabel && <> · {entry.record.reasonLabel}</>}
        {entry.record.competency && <> · {competencyLabels[entry.record.competency]}</>}</>;
      break;
    case 'reflection':
      content = <>{entry.record.author === 'mentor' ? zh ? '教師評語' : 'Teacher comment' : zh ? '學習反思' : 'Learning reflection'}
        {' · '}{competencyLabels[entry.record.competency]}{entry.record.text && <p className="mt-2 whitespace-pre-wrap break-words">{entry.record.text}</p>}</>;
      break;
    case 'penalty': {
      const labels = { warning: zh ? '警告' : 'Warning', autoPenalty: zh ? '自動處罰' : 'Automatic penalty', discipline: copy.discipline,
        levelDecrease: zh ? '等級調整' : 'Level reduction', reversal: zh ? '撤銷處置' : 'Reversal' };
      content = <>{zh ? '處罰紀錄' : 'Penalty record'} · {labels[entry.record.type]}
        {entry.record.reason && <p className="mt-2 whitespace-pre-wrap break-words">{entry.record.reason}</p>}</>;
      break;
    }
    case 'boss':
      content = <>{zh ? 'Boss 獎勵紀錄' : 'Boss reward record'} · {entry.record.bossName}
        <p className="mt-2">{zh ? '傷害' : 'Damage'} {entry.record.damage} · {zh ? '攻擊次數' : 'Attacks'} {entry.record.attackCount}
          {' · '}{zh ? '獎勵點數' : 'Reward points'} {entry.record.rewardPoints} · RP {entry.record.rewardRankPoints}</p></>;
      break;
    case 'economy': {
      const labels = { feed: zh ? '餵食' : 'Feeding', play: zh ? '玩耍' : 'Playing', upgrade: zh ? '升級' : 'Upgrade', gacha: zh ? '抽取寵物' : 'Pet draw',
        upgradeReroll: zh ? '升級重抽' : 'Upgrade reroll', revive: zh ? '恢復寵物' : 'Pet recovery',
        soloBattle: zh ? '個人對戰' : 'Solo battle', teamBattle: zh ? '團隊對戰' : 'Team battle', bossReward: zh ? 'Boss 獎勵' : 'Boss reward' };
      content = <>{zh ? '遊戲資源紀錄' : 'Game resource record'} · {labels[entry.record.source]} · {entry.record.amount}
        {entry.record.previousPetType && <> · {entry.record.previousPetType}</>}
        {entry.record.newPetType && <> → {entry.record.newPetType}</>}</>;
      break;
    }
  }
  return <li className="border-b border-slate-200 py-4 last:border-b-0">
    <p className="break-words text-sm font-black text-slate-900">{entry.studentName}</p>
    <div className="mt-1 text-sm leading-7 text-slate-700">{content}</div>
    <p className="mt-1 text-xs text-slate-600"><time dateTime={archiveTimeIso(entry.record.createdAt)}>{formatArchiveTime(entry.record.createdAt, language)}</time> UTC</p>
  </li>;
};

/** Teacher-console presentation of retained records. No store access or mutation callbacks. */
export const ArchivedClassHistoryPanel: React.FC<ArchivedClassHistoryPanelProps> = ({ classroom, language }) => {
  const id = useId();
  const zh = language === 'zh';
  const [selectedExamId, setSelectedExamId] = useState('');
  // Selecting an exam must not re-sort every retained history or recalculate unrelated assessments.
  const history = useMemo(() => getArchivedClassHistory(classroom), [classroom]);
  const selectedExam = history?.exams.find((exam) => exam.id === selectedExamId) ?? history?.exams[0];
  const examAnalyses = useMemo(() => history && selectedExam
    ? getArchivedExamAnalyses(history.exams, selectedExam.id, history.students) : [], [history, selectedExam]);
  const names = useMemo(() => new Map(classroom.students.map((student) => [student.id, student.name])), [classroom.students]);
  const competencyLabels = getCompetencyLabels(language);
  const levelLabels = { needsSupport: zh ? '需要支持' : 'Needs support', progressing: zh ? '持續進步' : 'Progressing', mastered: zh ? '已掌握' : 'Mastered' };
  const typeLabels = { observation: zh ? '觀察' : 'Observation', assignment: zh ? '作業' : 'Assignment', reflection: zh ? '反思' : 'Reflection', project: zh ? '專題' : 'Project', assessment: zh ? '評量' : 'Assessment' };
  const trendLabels = { improving: zh ? '進步中' : 'Improving', declining: zh ? '需要關注' : 'Needs attention', stable: zh ? '大致持平' : 'Stable', first: zh ? '首次紀錄' : 'First record' };

  if (!history) return <p role="status" className="text-sm text-slate-700">{zh ? '歷史檢視僅適用於已封存班級。' : 'Historical view is available only for archived classes.'}</p>;

  return <article aria-labelledby={`${id}-title`} className="mt-6 overflow-hidden rounded-2xl border border-slate-300 bg-[#f6f3ec]">
    <header className="border-b border-slate-300 bg-cyan-950 px-5 py-5 text-white sm:px-6">
      <p className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[0.2em]"><LockKeyhole className="h-4 w-4" aria-hidden="true" />{zh ? '封存 · 唯讀歷史' : 'ARCHIVED · READ-ONLY HISTORY'}</p>
      <h4 id={`${id}-title`} className="mt-2 break-words font-serif text-2xl font-black">{classroom.name}</h4>
      <p className="mt-3 text-sm leading-7">{zh ? '快照時間' : 'Snapshot time'}: <time dateTime={archiveTimeIso(history.archivedAt)}>{formatArchiveTime(history.archivedAt, language)}</time> UTC</p>
    </header>
    <div className="space-y-7 p-5 sm:p-6">
      <p className="flex items-start gap-2 text-sm leading-7 text-slate-700"><FileClock className="mt-1 h-5 w-5 shrink-0 text-cyan-800" aria-hidden="true" />{zh
        ? '以下為封存時保留的教學資料；寵物衰減、點數、對戰與 Boss 不會在此檢視中執行。包含學生資料與教師回饋，僅供管理介面檢視，不適合公開投影。敏感操作的稽核資訊保留在「稽核」頁。'
        : 'These are retained teaching records. This view does not advance pet decay or perform points, battle or boss actions. Student data and teacher feedback are private console information, not for classroom projection. Sensitive-action audit information remains in the Audit tab.'}</p>

      <section aria-labelledby={`${id}-learning-title`}>
        <h5 id={`${id}-learning-title`} className="text-lg font-black text-slate-950">{zh ? '歷史學習證據' : 'Historical learning evidence'} · {history.evidence.length}</h5>
        {history.evidence.length === 0 ? <p className="mt-3 text-sm text-slate-600">{zh ? '沒有保留的學習證據。' : 'No retained learning evidence.'}</p> : <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-300 bg-white px-4">{history.evidence.map((record) => <li key={record.id} className="py-4">
          <p className="break-words text-sm font-black text-slate-950">{record.title}</p>
          <p className="mt-1 break-words text-sm text-slate-700">{names.get(record.studentId) ?? (zh ? '已移除的學生' : 'Removed student')} · {competencyLabels[record.competency]} · {typeLabels[record.evidenceType]} · {levelLabels[record.level]}</p>
          {record.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{record.note}</p>}
          <p className="mt-2 text-xs text-slate-600"><time dateTime={archiveTimeIso(record.createdAt)}>{formatArchiveTime(record.createdAt, language)}</time> UTC · {zh ? '版本' : 'Revision'} {record.revision}</p>
        </li>)}</ul>}
        {history.goals.length > 0 && <details className="mt-4 rounded-xl border border-slate-300 bg-white p-4">
          <summary className="cursor-pointer text-sm font-black text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">{zh ? '保留的班級目標' : 'Retained class goals'} · {history.goals.length}</summary>
          <ul className="mt-3 space-y-3">{history.goals.map((goal) => <li key={goal.id} className="break-words text-sm leading-7 text-slate-700">{goal.title} · {competencyLabels[goal.competency]} · {zh ? '目標數量' : 'Target count'} {goal.targetCount}</li>)}</ul>
        </details>}
      </section>

      <section aria-labelledby={`${id}-exam-title`} className="border-t border-slate-300 pt-6">
        <h5 id={`${id}-exam-title`} className="text-lg font-black text-slate-950">{zh ? '歷史考試分析' : 'Historical exam analytics'} · {history.exams.length}</h5>
        {selectedExam ? <>
          <label htmlFor={`${id}-exam`} className="mt-4 block text-sm font-black text-slate-800">{zh ? '選擇保留的考試' : 'Select retained assessment'}</label>
          <select id={`${id}-exam`} value={selectedExam.id} onChange={(event) => setSelectedExamId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">
            {history.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.examDate} · {exam.title}</option>)}
          </select>
          <p className="mt-3 text-sm leading-7 text-slate-700">{zh ? '班級平均得分率' : 'Class average'}: {formatExamPercent(examAnalyses[0]?.analysis?.classAveragePercent ?? null)} · {zh ? '評量項目' : 'Assessment items'} {selectedExam.items.length}</p>
          <div role="region" aria-label={zh ? '封存考試成績表' : 'Archived exam score table'} tabIndex={0} className="mt-4 overflow-x-auto rounded-xl border border-slate-300 bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">{selectedExam.title} · {zh ? '封存考試得分與趨勢' : 'Archived assessment scores and trends'}</caption>
              <thead className="bg-[#e7e2d8] text-slate-900"><tr>{[zh ? '學生' : 'Student', zh ? '整體得分率' : 'Overall', zh ? '較上次' : 'vs. previous', zh ? '趨勢' : 'Trend', zh ? '已填項目' : 'Entered items'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-black">{label}</th>)}</tr></thead>
              <tbody>{examAnalyses.map(({ student, analysis }) => <tr key={student.id} className="border-t border-slate-200 text-slate-800">
                <th scope="row" className="break-words px-4 py-3 font-bold">{student.name}</th>
                <td className="px-4 py-3">{formatExamPercent(analysis?.overallPercent ?? null)}</td>
                <td className="px-4 py-3">{formatExamDelta(analysis?.trendDelta ?? null)}</td>
                <td className="px-4 py-3">{analysis?.overallPercent == null ? zh ? '沒有得分紀錄' : 'No score recorded' : trendLabels[analysis.trend]}</td>
                <td className="px-4 py-3">{analysis?.completedItemCount ?? 0}/{selectedExam.items.length}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 space-y-3">{examAnalyses.map(({ student, analysis }) => analysis && <details key={student.id} className="rounded-xl border border-slate-300 bg-white p-4">
            <summary className="cursor-pointer break-words text-sm font-black text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">{student.name} · {zh ? '項目分析與教師評語' : 'Item analysis and teacher comment'}</summary>
            <ul className="mt-3 space-y-2">{analysis.itemAnalyses.map((item) => <li key={item.itemId} className="break-words text-sm leading-7 text-slate-700">{item.name}: {item.score ?? '—'}/{item.maxScore} · {formatExamPercent(item.percent)} · {zh ? '班級平均' : 'Class average'} {formatExamPercent(item.classAveragePercent)} · {zh ? '較上次' : 'vs. previous'} {formatExamDelta(item.trendDelta)}</li>)}</ul>
            <p className="mt-3 text-sm leading-7 text-slate-700">{zh ? '優先加強' : 'Focus areas'}: {analysis.weaknessItems.map((item) => item.name).join(' · ') || (zh ? '目前未辨識' : 'None identified')}</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700"><strong>{zh ? '教師評語' : 'Teacher comment'}: </strong>{analysis.mentorComment || (zh ? '未填寫' : 'Not recorded')}</p>
          </details>)}</div>
        </> : <p className="mt-3 text-sm text-slate-600">{zh ? '沒有保留的考試。' : 'No retained assessments.'}</p>}
      </section>

      <section aria-labelledby={`${id}-activity-title`} className="border-t border-slate-300 pt-6">
        <h5 id={`${id}-activity-title`} className="text-lg font-black text-slate-950">{zh ? '點數、評語與遊戲歷史' : 'Points, comments and game history'} · {history.activities.length}</h5>
        {history.activities.length === 0 ? <p className="mt-3 text-sm text-slate-600">{zh ? '沒有保留的活動紀錄。' : 'No retained activity records.'}</p> : <details className="mt-3 rounded-xl border border-slate-300 bg-white px-4 py-4">
          <summary className="cursor-pointer text-sm font-black text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-800">{zh ? '查看全部保留紀錄' : 'View all retained records'} · {history.activities.length}</summary>
          <ul className="mt-2">{history.activities.map((entry) => <HistoryActivity key={`${entry.studentId}-${entry.kind}-${entry.record.id}`} entry={entry} language={language} />)}</ul>
        </details>}
        {history.boss && <p className="mt-4 rounded-xl border border-slate-300 bg-white p-4 text-sm leading-7 text-slate-700"><strong>{zh ? '封存時的 Boss 快照' : 'Boss snapshot at archive'}: </strong>{history.boss.name} · HP {history.boss.currentHp}/{history.boss.maxHp} · {zh ? '僅歷史快照，不會啟動或攻擊' : 'Historical snapshot only; no start or attack action'}</p>}
      </section>
    </div>
  </article>;
};

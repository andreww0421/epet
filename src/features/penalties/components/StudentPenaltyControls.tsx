import { AlertCircle, ChevronsDown, Minus, Shield, X, Zap } from 'lucide-react';
import { hasActiveLevelDecreaseCooldown, isPenaltyActive, WARNING_THRESHOLD } from '../../../gameRules';
import { translations } from '../../../i18n/translations';
import type { Language, Student } from '../../../store/types';

type DashboardCopy = (typeof translations)[keyof typeof translations];

type StudentPenaltyStatusProps = {
  language: Language;
  onRemovePenalty: (studentId: string) => void;
  onRemoveWarning: (studentId: string) => void;
  student: Student;
};

/** Presents warning and active-penalty state for one student. */
export const StudentPenaltyStatus = ({
  language,
  onRemovePenalty,
  onRemoveWarning,
  student,
}: StudentPenaltyStatusProps) => {
  const copy = translations[language];
  const warningPoints = student.warningPoints ?? 0;
  const activePenalty = isPenaltyActive(student.penaltyStatus);
  const penaltyUntil = student.penaltyStatus
    ? new Date(student.penaltyStatus.until).toLocaleString(
        language === 'zh' ? 'zh-TW' : 'en-US',
        { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
      )
    : '';

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${warningPoints > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
          <AlertCircle className="mr-1 h-3 w-3" />
          {copy.warningPoints} {warningPoints}/{WARNING_THRESHOLD}
        </span>
        {warningPoints > 0 && (
          <button onClick={() => onRemoveWarning(student.id)} className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300" title={language === 'en' ? 'Remove Warning' : '消除警告'}>
            <Minus className="h-3 w-3" />
          </button>
        )}
        {activePenalty && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            <Zap className="mr-1 h-3 w-3" />
            {copy.penaltyStatus}
          </span>
        )}
        {activePenalty && (
          <button onClick={() => onRemovePenalty(student.id)} className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-300" title={language === 'en' ? 'Remove Penalty' : '解除虛弱'}>
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {activePenalty && student.penaltyStatus && (
        <div className="mt-1 text-[11px] text-amber-700">
          {copy.penaltyUntil.replace('{time}', penaltyUntil)}
        </div>
      )}
    </>
  );
};

type StudentPenaltyControlsProps = {
  language: Language;
  onDecreaseLevel: (studentId: string) => void;
  onDiscipline: (studentId: string, reason: string) => void;
  onMissingReason: () => void;
  onWarn: (studentId: string) => void;
  safetyUndoPending: boolean;
  student: Student;
};

/** Owns confirmation and availability rules for formal student safety actions. */
export const StudentPenaltyControls = ({
  language,
  onDecreaseLevel,
  onDiscipline,
  onMissingReason,
  onWarn,
  safetyUndoPending,
  student,
}: StudentPenaltyControlsProps) => {
  const copy: DashboardCopy = translations[language];
  const activePenalty = isPenaltyActive(student.penaltyStatus);
  const levelDecreaseOnCooldown = hasActiveLevelDecreaseCooldown(student.disciplineRecords);

  const requestDiscipline = () => {
    const enteredReason = window.prompt(
      language === 'en'
        ? `Required reason for ${copy.discipline.toLocaleLowerCase()} (${student.name})`
        : `請填寫${copy.discipline}理由（${student.name}）`,
    );
    if (enteredReason === null) return;
    const reason = enteredReason.trim();
    if (!reason) {
      onMissingReason();
      return;
    }
    const confirmed = window.confirm(
      language === 'en'
        ? `Confirm ${copy.discipline.toLocaleLowerCase()} for ${student.name}?\nReason: ${reason}`
        : `確定對 ${student.name} 執行${copy.discipline}？\n理由：${reason}`,
    );
    if (confirmed) onDiscipline(student.id, reason);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const confirmed = window.confirm(language === 'en'
            ? `Decrease ${student.name}'s pet by one level? You can undo this for 10 seconds.`
            : `確定將 ${student.name} 的寵物降低 1 級？完成後 10 秒內可撤銷。`);
          if (confirmed) onDecreaseLevel(student.id);
        }}
        disabled={(student.pet.level || 1) <= 1 || levelDecreaseOnCooldown || safetyUndoPending}
        aria-label={`${copy.decreaseLevel}：${student.name}`}
        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={levelDecreaseOnCooldown ? (language === 'en' ? 'Level decrease is on a 24-hour cooldown' : '降級操作尚在 24 小時冷卻期') : copy.decreaseLevel}
      >
        <ChevronsDown className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="flex space-x-1 bg-amber-50 p-1 rounded-md border border-amber-100">
        <button type="button" onClick={() => onWarn(student.id)} aria-label={`${copy.issueWarning}：${student.name}`} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors" title={copy.issueWarning}>
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={requestDiscipline}
          disabled={activePenalty || safetyUndoPending}
          aria-label={`${copy.discipline}：${student.name}`}
          className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          title={copy.discipline}
        >
          <Shield className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </>
  );
};

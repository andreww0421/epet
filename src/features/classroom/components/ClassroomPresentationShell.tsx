import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Expand, Minimize, Monitor, ShieldCheck } from 'lucide-react';
import { ModalDialog } from '../../../components/ModalDialog';
import type { Language } from '../../../store/types';
import type { ClassroomPresentationOptions } from '../model/classroomPresentation';

type Props = {
  language: Language;
  allowUnmaskedNames?: boolean;
  allowRankedLeaderboard?: boolean;
  onExit: () => void;
  children: (options: ClassroomPresentationOptions) => ReactNode;
};

/** The public shell has no teacher navigation, account controls or arbitrary
 * toast/reward slots. Exiting fullscreen (including Escape) keeps this shell. */
export const ClassroomPresentationShell = ({ language, allowUnmaskedNames = false, allowRankedLeaderboard = false, onExit, children }: Props) => {
  const zh = language === 'zh';
  const root = useRef<HTMLDivElement>(null);
  const modeHeading = useRef<HTMLParagraphElement>(null);
  const [maskNames, setMaskNames] = useState(true);
  const [inclusiveLeaderboard, setInclusiveLeaderboard] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenBusy, setFullscreenBusy] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [confirmation, setConfirmation] = useState<'exit' | 'names' | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => { modeHeading.current?.focus(); }, []);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const toggleFullscreen = async () => {
    if (fullscreenBusy) return;
    setFullscreenBusy(true);
    setFullscreenError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
    } catch {
      setFullscreenError(true);
    } finally {
      setFullscreenBusy(false);
    }
  };
  const confirmExit = async () => {
    if (fullscreenBusy) return;
    setFullscreenBusy(true);
    setFullscreenError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      onExit();
    } catch {
      // If the browser cannot leave fullscreen, do not expose private content.
      setFullscreenError(true);
    } finally {
      setFullscreenBusy(false);
    }
  };
  const buttonClass = 'min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800';

  return <div ref={root} className="min-h-screen w-full overflow-y-auto bg-amber-50 font-sans text-slate-900" data-presentation-mode="true">
    <header className="border-b border-amber-200 bg-white px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><Monitor className="h-6 w-6 text-amber-800" aria-hidden="true" /><div>
          <p ref={modeHeading} tabIndex={-1} className="font-bold text-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">{zh ? '投影模式' : 'Presentation mode'}</p>
          <p className="text-sm text-slate-700">{zh ? '唯讀展示；管理與私人紀錄不會出現在這裡。' : 'Read-only display. Management and private records are not shown here.'}</p>
        </div></div>
        <nav aria-label={zh ? '投影控制' : 'Presentation controls'} className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-950">
            <input type="checkbox" checked={!allowUnmaskedNames || maskNames} disabled={!allowUnmaskedNames} onChange={(event) => {
              if (event.target.checked) setMaskNames(true);
              else setConfirmation('names');
            }} className="h-5 w-5 accent-amber-800" />{zh ? '遮罩學生姓名' : 'Mask student names'}
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-950">
            <input type="checkbox" checked={!allowRankedLeaderboard || inclusiveLeaderboard} disabled={!allowRankedLeaderboard} onChange={(event) => setInclusiveLeaderboard(event.target.checked)} className="h-5 w-5 accent-amber-800" />{zh ? '包容性排行榜' : 'Inclusive leaderboard'}
          </label>
          <button type="button" onClick={() => void toggleFullscreen()} disabled={fullscreenBusy} aria-pressed={fullscreen} className={buttonClass}>
            {fullscreen ? <Minimize className="mr-2 inline h-4 w-4" aria-hidden="true" /> : <Expand className="mr-2 inline h-4 w-4" aria-hidden="true" />}{fullscreen ? (zh ? '離開全螢幕' : 'Leave fullscreen') : (zh ? '全螢幕投影' : 'Present fullscreen')}
          </button>
          <button type="button" onClick={() => setConfirmation('exit')} className={buttonClass}>{zh ? '結束投影' : 'End presentation'}</button>
        </nav>
      </div>
      {(!allowUnmaskedNames || !allowRankedLeaderboard) && <p className="mx-auto mt-3 max-w-7xl text-xs leading-5 text-slate-700"><ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />{zh ? '工作區隱私設定優先：投影選項不會解除姓名遮罩或隱藏排行榜。' : 'Workspace privacy takes priority. Display options cannot override masked names or hidden rankings.'}</p>}
      {fullscreenError && !confirmation && <p role="alert" className="mx-auto mt-3 max-w-7xl text-sm font-semibold text-rose-800">{zh ? '瀏覽器無法變更全螢幕狀態；仍保持投影模式。請使用瀏覽器控制重試。' : 'Fullscreen could not be changed. Presentation mode remains active. Retry using the browser controls.'}</p>}
    </header>
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children({ maskNames: !allowUnmaskedNames || maskNames, inclusiveLeaderboard: !allowRankedLeaderboard || inclusiveLeaderboard })}</main>
    {confirmation && <ModalDialog labelledBy={titleId} describedBy={descriptionId} onClose={() => setConfirmation(null)} closeDisabled={fullscreenBusy} className="max-w-md">
      <div className="p-6"><h2 id={titleId} className="text-xl font-bold text-slate-950">{confirmation === 'exit' ? (zh ? '返回教師控制台？' : 'Return to Teacher Console?') : (zh ? '顯示完整學生姓名？' : 'Show full student names?')}</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-700">{confirmation === 'exit' ? (zh ? '請先停止投影或分享畫面。返回後可能顯示私人評語、考試與管理資料。Esc 或取消會繼續投影。' : 'Stop projecting or sharing your screen first. Returning may show private notes, exams and administration. Escape or Cancel keeps the display active.') : (zh ? '全班將可看到完整姓名。只在已取得適當同意的情況下顯示；此選項不會儲存。' : 'Full names will be visible to the class. Only show them with appropriate consent. This preference is not stored.')}</p>
        {fullscreenError && confirmation === 'exit' && <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{zh ? '無法離開全螢幕，仍保持投影模式。請重試或取消。' : 'Could not leave fullscreen. Presentation mode remains active. Retry or cancel.'}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-4"><button type="button" autoFocus disabled={fullscreenBusy} onClick={() => setConfirmation(null)} className={buttonClass}>{zh ? '取消' : 'Cancel'}</button>
        <button type="button" disabled={fullscreenBusy} onClick={() => {
          if (confirmation === 'exit') void confirmExit();
          else { setMaskNames(false); setConfirmation(null); }
        }} className="min-h-11 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">{confirmation === 'exit' ? (zh ? '已停止投影，返回控制台' : 'Projection stopped — return to console') : (zh ? '確認顯示完整姓名' : 'Confirm full names')}</button>
      </div>
    </ModalDialog>}
  </div>;
};

/** Used while loading, denied, expired or signed out: never render cached data,
 * account/email forms, migration or data-export recovery controls to a class. */
export const PresentationPaused = ({ language }: { language: Language }) => <section className="py-20 text-center" aria-live="polite">
  <h1 className="text-2xl font-bold text-amber-950">{language === 'zh' ? '投影已暫停' : 'Presentation paused'}</h1>
  <p className="mt-3 text-sm text-slate-700">{language === 'zh' ? '目前無法安全顯示班級。請先結束投影，再至教師控制台處理連線或登入。' : 'The classroom cannot be shown safely. End presentation before resolving connection or sign-in issues in Teacher Console.'}</p>
</section>;

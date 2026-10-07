import type { Language } from '../../../store/types';
import type { ConsoleDestination } from '../model/navigation';

/** Direct routes to existing security controls; no invented session or password APIs. */
export const ConsoleSecurityPanel = ({ language, onNavigate }: { language: Language; onNavigate: (id: ConsoleDestination) => void }) => (
  <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h3 className="text-base font-bold text-slate-900">{language === 'en' ? 'Account and workspace security' : '帳號與工作區安全'}</h3>
    <p className="mt-2 text-sm leading-6 text-slate-600">{language === 'en' ? 'Manage memberships and invitations in Workspace and users. Review access audit records and account lifecycle in Data governance. Password recovery remains on the sign-in screen.' : '成員權限與邀請由「工作區與使用者」管理；存取稽核與帳號生命週期位於「資料治理」。密碼重設仍使用登入畫面的既有流程。'}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => onNavigate('workspace')} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold text-indigo-800">{language === 'en' ? 'Workspace and users' : '工作區與使用者'}</button>
      <button type="button" onClick={() => onNavigate('governance')} className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold text-indigo-800">{language === 'en' ? 'Audit and account lifecycle' : '稽核與帳號生命週期'}</button>
    </div>
  </section>
);

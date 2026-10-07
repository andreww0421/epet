import { Crosshair } from 'lucide-react';
import type { BattleMode, BossAttackMode, Language } from '../../../store/types';
import type { DashboardSettingsModel } from '../hooks/useDashboardSettings';

type GameRuleSettingsProps = {
  model: DashboardSettingsModel;
  mode?: 'rules' | 'rewards' | 'all';
};

/** Numeric game, boss, battle, rank, and season setting fields. */
export const GameRuleSettings = ({ model, mode = 'all' }: GameRuleSettingsProps) => {
  const { battle, boss, context, economy, general, privacy, season } = model;
  const { copy, lang } = context;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
      <div hidden={mode === 'rewards'} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
          {lang === 'en' ? 'General Rules' : '基本規則'}
        </h3>
        <div className="flex flex-col gap-1">
          <label htmlFor="language" className="text-sm font-medium text-slate-700">{copy.language}</label>
          <select id="language" value={general.languageDraft} onChange={(event) => general.onLanguageDraftChange(event.target.value as Language)} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="maxPoints" className="text-sm font-medium text-slate-700">{copy.maxPoints ?? '總積分上限'}</label>
          <input type="number" id="maxPoints" min="0" value={general.maxPoints} onChange={(event) => general.setMaxPoints(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="decayType" className="text-sm font-medium text-slate-700">{copy.decayFrequency}</label>
          <select id="decayType" value={general.decayType} onChange={(event) => general.setDecayType(event.target.value as 'hourly' | 'daily')} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
            <option value="hourly">{copy.hourly}</option>
            <option value="daily">{copy.daily}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="decayAmount" className="text-sm font-medium text-slate-700">{copy.decayAmount}</label>
          <input type="number" id="decayAmount" min="0" value={general.decayAmount} onChange={(event) => general.setDecayAmount(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
      </div>

      <div hidden={mode === 'rewards'} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
          {lang === 'en' ? 'Economy & Interactions' : '經濟與互動數值'}
        </h3>
        <div className="flex flex-col gap-1">
          <label htmlFor="feedCost" className="text-sm font-medium text-slate-700">{copy.feedCost}</label>
          <input type="number" id="feedCost" min="1" value={economy.feedCost} onChange={(event) => economy.setFeedCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="feedGain" className="text-sm font-medium text-slate-700">{copy.feedGain ?? '餵食回復飽食度'}</label>
          <input type="number" id="feedGain" min="1" value={economy.feedGain} onChange={(event) => economy.setFeedGain(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="playCost" className="text-sm font-medium text-slate-700">{copy.playCost ?? '玩耍所需積分'}</label>
          <input type="number" id="playCost" min="1" value={economy.playCost} onChange={(event) => economy.setPlayCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="playGain" className="text-sm font-medium text-slate-700">{copy.playGain ?? '玩耍回復心情'}</label>
          <input type="number" id="playGain" min="1" value={economy.playGain} onChange={(event) => economy.setPlayGain(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
        </div>
        {privacy.petCareModeDraft === 'death' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="reviveCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Revive Cost' : '復活需要積分'}</label>
            <input type="number" id="reviveCost" min="0" value={economy.reviveCost} onChange={(event) => economy.setReviveCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
          </div>
        )}
      </div>

      <div hidden={mode === 'rewards'} className="space-y-4 bg-rose-50 p-4 rounded-xl border border-rose-200">
        <h3 className="text-sm font-bold text-rose-800 pb-2 border-b border-rose-200 flex items-center">
          <Crosshair className="mr-2 h-4 w-4" />
          {copy.bossAttackSettings}
        </h3>
        <div className="flex flex-col gap-1">
          <label htmlFor="bossAttackMode" className="text-sm font-medium text-slate-700">{copy.bossAttackMode}</label>
          <select id="bossAttackMode" value={boss.bossAttackMode} onChange={(event) => boss.setBossAttackMode(event.target.value as BossAttackMode)} disabled={privacy.inclusiveMode} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500">
            <option value="recoverable">{copy.bossAttackRecoverable}</option>
            <option value="shared">{copy.bossAttackShared}</option>
            <option value="random">{copy.bossAttackRandom}</option>
          </select>
          <p className="text-xs text-slate-600">
            {boss.bossAttackMode === 'recoverable'
              ? copy.bossAttackRecoverableHint
              : boss.bossAttackMode === 'shared'
                ? copy.bossAttackSharedHint
                : copy.bossAttackRandomHint}
          </p>
        </div>
        {boss.bossAttackMode === 'random' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="bossAttackMaxTargets" className="text-sm font-medium text-slate-700">{copy.bossAttackMaxTargets}</label>
            <select id="bossAttackMaxTargets" value={boss.bossAttackMaxTargets} onChange={(event) => boss.setBossAttackMaxTargets(Number(event.target.value))} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500">
              {[0, 1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>{copy.bossTargetCountOption.replace('{count}', count.toString())}</option>
              ))}
            </select>
            <p className="text-xs text-slate-600">{copy.bossAttackMaxTargetsHint}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="bossAttackDamage" className="text-sm font-medium text-slate-700">
            {boss.bossAttackMode === 'recoverable'
              ? copy.bossShieldImpact
              : boss.bossAttackMode === 'shared'
                ? copy.bossSharedDamage
                : copy.bossAttackDamage}
          </label>
          <input type="number" id="bossAttackDamage" min="0" value={boss.bossAttackDamage} onChange={(event) => boss.setBossAttackDamage(Number(event.target.value))} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-rose-500 focus:ring-rose-500" />
          <p className="text-xs text-slate-600">
            {boss.bossAttackMode === 'recoverable'
              ? copy.bossAttackRecoverableHint
              : boss.bossAttackMode === 'shared'
                ? copy.bossAttackSharedHint
                : copy.bossAttackDamageHint}
          </p>
        </div>
        {boss.bossAttackMode === 'recoverable' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="bossRecoveryMinutes" className="text-sm font-medium text-slate-700">{copy.bossRecoveryMinutes}</label>
            <input type="number" id="bossRecoveryMinutes" min="1" max="120" value={boss.bossRecoveryMinutes} onChange={(event) => boss.setBossRecoveryMinutes(Number(event.target.value))} className="w-full rounded-md border border-sky-200 bg-white p-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500" />
            <p className="text-xs text-sky-700">{copy.bossRecoveryMinutesHint}</p>
          </div>
        ) : (
          <p className="border-l-4 border-amber-400 bg-amber-50 p-3 text-xs font-medium text-amber-800">{copy.bossPersistentImpactWarning}</p>
        )}
      </div>

      <div hidden={mode === 'rewards'} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
          {lang === 'en' ? 'Battle Settings' : '對戰與組隊設定'}
        </h3>
        <div className="flex items-start justify-between gap-4 rounded-md border border-slate-200 bg-white p-3">
          <div>
            <p className="text-sm font-bold text-slate-800">{copy.battleEnabled}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.battleEnabledHint}</p>
          </div>
          <button type="button" role="switch" aria-checked={battle.battleEnabled} aria-label={copy.battleEnabled} onClick={() => battle.setBattleEnabled((enabled) => !enabled)} className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center justify-start rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${battle.battleEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}>
            <span className={`block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${battle.battleEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <fieldset disabled={!battle.battleEnabled} className={`space-y-4 transition-opacity ${battle.battleEnabled ? '' : 'opacity-45'}`}>
          <div className="flex flex-col gap-1">
            <label htmlFor="battleMode" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Mode' : '支援對戰模式'}</label>
            <select id="battleMode" value={battle.battleMode} onChange={(event) => battle.setBattleMode(event.target.value as BattleMode)} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
              <option value="both">{lang === 'en' ? 'Solo + Team' : '個人賽 + 隊伍賽'}</option>
              <option value="solo">{lang === 'en' ? 'Solo Only' : '僅個人賽'}</option>
              <option value="team">{lang === 'en' ? 'Team Only' : '僅隊伍賽'}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="maxTeamSize" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Max Team Size' : '隊伍上限人數'}</label>
            <input type="number" id="maxTeamSize" min="2" max="6" value={battle.maxTeamSize} onChange={(event) => battle.setMaxTeamSize(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="battleRankPointsWin" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Win RP' : '對戰獲勝加分 (RP)'}</label>
            <input type="number" id="battleRankPointsWin" min="0" value={battle.battleRankPointsWin} onChange={(event) => battle.setBattleRankPointsWin(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="battleRankPointsLoss" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Battle Loss RP' : '落敗扣分 (RP)'}</label>
            <input type="number" id="battleRankPointsLoss" min="0" value={battle.battleRankPointsLoss} onChange={(event) => battle.setBattleRankPointsLoss(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
          </div>
          <div className="pt-2 border-t border-slate-200 mt-2 space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="battleSettingsCategory" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Rules to Adjust' : '調整賽制'}</label>
              <select id="battleSettingsCategory" value={battle.battleSettingsCategory} onChange={(event) => battle.setBattleSettingsCategory(event.target.value as 'solo' | 'team')} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2">
                <option value="solo">{lang === 'en' ? 'Solo Battle Rules' : '個人賽飽食度機制'}</option>
                <option value="team">{lang === 'en' ? 'Team Battle Rules' : '隊伍賽飽食度機制'}</option>
              </select>
            </div>

            {battle.battleSettingsCategory === 'solo' ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-500">{lang === 'en' ? 'Solo battle costs are based on whether the student starts or receives the challenge.' : '個人賽依學生是發起挑戰或接受挑戰，分別套用飽食度消耗。'}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="soloBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Attacker Fullness Cost' : '進攻方消耗飽食度'}</label>
                    <input type="number" id="soloBattleAttackerFullnessCost" min="0" value={battle.soloBattleAttackerFullnessCost} onChange={(event) => battle.setSoloBattleAttackerFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="soloBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Defender Fullness Cost' : '防守方消耗飽食度'}</label>
                    <input type="number" id="soloBattleDefenderFullnessCost" min="0" value={battle.soloBattleDefenderFullnessCost} onChange={(event) => battle.setSoloBattleDefenderFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="soloBattleWinPoints" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Solo Win Points' : '個人賽勝利積分'}</label>
                    <input type="number" id="soloBattleWinPoints" min="0" value={battle.soloBattleWinPoints} onChange={(event) => battle.setSoloBattleWinPoints(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="soloBattleLossPoints" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Solo Loss Penalty' : '個人賽失敗扣分'}</label>
                    <input type="number" id="soloBattleLossPoints" min="0" value={battle.soloBattleLossPoints} onChange={(event) => battle.setSoloBattleLossPoints(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-500">{lang === 'en' ? 'Team battle costs are based on each participant role, independent of the match result.' : '隊伍賽依每位成員在本場的角色扣除飽食度，不受勝敗結果影響。'}</p>
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Attacking Team' : '攻擊方'}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleAttackerFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Initiator Fullness Cost' : '發動攻擊者消耗飽食度'}</label>
                      <input type="number" id="teamBattleAttackerFullnessCost" min="0" value={battle.teamBattleAttackerFullnessCost} onChange={(event) => battle.setTeamBattleAttackerFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleAttackerTeammateFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Attacking Teammate Cost' : '攻擊方隊友消耗飽食度'}</label>
                      <input type="number" id="teamBattleAttackerTeammateFullnessCost" min="0" value={battle.teamBattleAttackerTeammateFullnessCost} onChange={(event) => battle.setTeamBattleAttackerTeammateFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <h4 className="text-xs font-bold text-slate-600">{lang === 'en' ? 'Defending Team' : '防守方'}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleDefenderFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Target Fullness Cost' : '被攻擊者消耗飽食度'}</label>
                      <input type="number" id="teamBattleDefenderFullnessCost" min="0" value={battle.teamBattleDefenderFullnessCost} onChange={(event) => battle.setTeamBattleDefenderFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="teamBattleDefenderTeammateFullnessCost" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Defending Teammate Cost' : '防守方隊友消耗飽食度'}</label>
                      <input type="number" id="teamBattleDefenderTeammateFullnessCost" min="0" value={battle.teamBattleDefenderTeammateFullnessCost} onChange={(event) => battle.setTeamBattleDefenderTeammateFullnessCost(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={battle.teamBattleMinFullnessEnabled} onChange={(event) => battle.setTeamBattleMinFullnessEnabled(event.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Enable team minimum fullness gate' : '隊伍賽啟用最低飽食度限制'}</span>
                  </label>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="teamBattleMinFullness" className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Team Minimum Fullness' : '隊伍賽最低飽食度'}</label>
                    <input type="number" id="teamBattleMinFullness" min="0" value={battle.teamBattleMinFullness} disabled={!battle.teamBattleMinFullnessEnabled} onChange={(event) => battle.setTeamBattleMinFullness(Number(event.target.value))} className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 sm:text-sm border p-2" />
                  </div>
                  <p className="text-xs text-slate-500">
                    {battle.teamBattleMinFullnessEnabled
                      ? (lang === 'en' ? 'Only members meeting this fullness value can enter team battles.' : '只有達到此飽食度的成員才能參與隊伍賽。')
                      : (lang === 'en' ? 'When disabled, team battles ignore the minimum fullness requirement.' : '關閉後，隊伍賽將忽略最低飽食度限制。')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </fieldset>
      </div>

      <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 pb-2 border-b border-slate-200">
          {mode === 'rewards'
            ? lang === 'en' ? 'Season Reset Rewards' : '賽季結算獎勵'
            : mode === 'rules'
              ? lang === 'en' ? 'Rank Thresholds' : '段位門檻'
              : lang === 'en' ? 'Rank & Season Settings' : '段位與賽季設定'}
        </h3>
        <div hidden={mode === 'rewards'}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Rank Thresholds' : '排位門檻 (RP)'}</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.diamond}</span><input type="number" value={season.bracketDiamond} onChange={(event) => season.setBracketDiamond(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.platinum}</span><input type="number" value={season.bracketPlatinum} onChange={(event) => season.setBracketPlatinum(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.gold}</span><input type="number" value={season.bracketGold} onChange={(event) => season.setBracketGold(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.silver}</span><input type="number" value={season.bracketSilver} onChange={(event) => season.setBracketSilver(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border" /></label>
            </div>
          </div>
        </div>
        <div hidden={mode === 'rules'} className="pt-2 border-t border-slate-200 mt-2">
          <label className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={season.enableSeasonResetRewards} onChange={(event) => season.setEnableSeasonResetRewards(event.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm font-medium text-slate-700">{lang === 'en' ? 'Enable Season Reset Rewards' : '啟用賽季結算獎勵'}</span>
          </label>
          {season.enableSeasonResetRewards && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.diamond}</span><input type="number" value={season.rewardDiamond} onChange={(event) => season.setRewardDiamond(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.platinum}</span><input type="number" value={season.rewardPlatinum} onChange={(event) => season.setRewardPlatinum(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.gold}</span><input type="number" value={season.rewardGold} onChange={(event) => season.setRewardGold(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.silver}</span><input type="number" value={season.rewardSilver} onChange={(event) => season.setRewardSilver(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
              <label className="flex items-center text-xs text-slate-600 gap-2"><span className="w-12">{copy.bronze}</span><input type="number" value={season.rewardBronze} onChange={(event) => season.setRewardBronze(Number(event.target.value))} className="w-full min-w-0 rounded border-slate-300 px-2 py-1 border shadow-sm" /></label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

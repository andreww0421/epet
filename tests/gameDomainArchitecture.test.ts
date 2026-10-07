import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as domainRules from '../src/domain/game/index.js';
import * as legacyRules from '../src/gameRules.js';

const EXPECTED_RUNTIME_EXPORTS = `
BOSS_ATTACK_FULLNESS_COST
DAILY_TASK_REWARD_HAPPINESS
DAILY_TASK_REWARD_POINTS
DEFAULT_BOSS_ATTACK_DAMAGE
DEFAULT_BOSS_ATTACK_MAX_TARGETS
DEFAULT_BOSS_IMPROVEMENT_REWARD
DEFAULT_BOSS_PARTICIPATION_REWARD
DEFAULT_BOSS_RECOVERY_MINUTES
DEFAULT_BOSS_REWARD_TIERS
DEFAULT_CATCH_UP_GAP_THRESHOLD
DEFAULT_DAILY_CATCH_UP_BONUS
DEFAULT_DAILY_NEGATIVE_POINT_LIMIT
DEFAULT_DAILY_POSITIVE_POINT_LIMIT
DEFAULT_DAILY_TASK_MAKEUP_WINDOW_DAYS
DEFAULT_MINIMUM_DAILY_PARTICIPATION_POINTS
DEFAULT_POSITIVE_FEEDBACK_RATIO_TARGET
DEFAULT_SCHOOL_TIME_ZONE
DEFAULT_SCHOOL_WEEKDAYS
DIRECT_DISCIPLINE_PENALTY
ECONOMY_EVENT_KINDS
ECONOMY_EVENT_SOURCES
FAIR_BOSS_RANKING_ATTACK_CAP
LEARNING_COMPETENCIES
LEVEL_DECREASE_COOLDOWN_MS
MAX_ACTIVITY_RECORDS
MAX_BOSS_RECOVERY_MINUTES
MAX_BOSS_REWARD_RECORDS
MAX_DAILY_REFLECTIONS
MAX_ECONOMY_EVENT_RECORDS
MAX_POINT_ADJUSTMENT_RECORDS
PENALTY_DURATION_MS
PET_DEATH_DELAY_MS
PET_GACHA_COST
PET_MAX_LEVEL
PET_UPGRADE_BASE_COST
PET_UPGRADE_COST_PER_LEVEL
PET_UPGRADE_FULLNESS_REQUIREMENT
PET_UPGRADE_MIN_HAPPINESS
REVIVE_COST
SOLO_BATTLE_FULLNESS_COST
SOLO_BATTLE_LOSS_POINTS
SOLO_BATTLE_MIN_FULLNESS
SOLO_BATTLE_WIN_POINTS
TEAM_BATTLE_ATTACKER_FULLNESS_COST
TEAM_BATTLE_ATTACKER_TEAMMATE_FULLNESS_COST
TEAM_BATTLE_DEFENDER_FULLNESS_COST
TEAM_BATTLE_DEFENDER_TEAMMATE_FULLNESS_COST
TEAM_BATTLE_LOSS_POINTS
TEAM_BATTLE_LOSS_RANK_POINTS
TEAM_BATTLE_MIN_FULLNESS
TEAM_BATTLE_MIN_FULLNESS_ENABLED
TEAM_BATTLE_SUPPORT_WEIGHT
TEAM_BATTLE_SYNERGY_BONUS
TEAM_BATTLE_TEAM_BONUS_HAPPINESS
TEAM_BATTLE_TEAM_BONUS_POINTS
TEAM_BATTLE_WIN_POINTS
TEAM_BATTLE_WIN_RANK_POINTS
UPGRADE_GACHA_LEVELS
UPGRADE_GACHA_LEVEL_SEQUENCE
UPGRADE_REWARD_FULLNESS
UPGRADE_REWARD_HAPPINESS
UPGRADE_REWARD_LEVEL
WARNING_AUTO_PENALTY
WARNING_THRESHOLD
addDaysToDateKey
appendEconomyEventToStudent
appendRecord
applyBossContributionRewards
applyDecayToStudent
applyFeedToStudent
applyParticipationSupportToStudent
applyPenaltyToStudent
applyPlayWithPet
applyPointAdjustmentToStudent
applyPointGuardrail
applySafetyActionReversal
attackWorldBoss
claimDailyTaskForStudent
clamp
createAutomatedBossRewardTier
createDisciplineRecord
createEconomyEventRecord
createPenaltyStatus
createPointAdjustmentRecord
createSafetyActionEffect
createSafetyActionSnapshot
getActiveClassGoals
getBattleBlockedReason
getBossAttackBlockedReason
getBossContributionStandings
getDailyTaskClaimPlan
getDailyTeacherPointTotals
getDateKey
getDateKeyDistance
getMedianPoints
getNextDailyTaskInstructionDate
getNextUpgradeGachaLevel
getParticipationSupportPlan
getPetUpgradeBlockedReason
getPetUpgradeCost
getTeamBattleReadyOptions
getUpcomingUpgradeGachaLevel
getWeekEndDate
getWeekStartDate
getWeekStartDateFromDateKey
hasActiveLevelDecreaseCooldown
isBattleReady
isBossRecoveryActive
isDailyTaskInstructionDate
isDateKey
isEconomyEventKind
isEconomyEventSource
isLearningCompetency
isPenaltyActive
isPetDead
normalizeDailyTaskMakeupWindowDays
normalizeDateKeyList
normalizePenaltyStatus
normalizeSchoolTimeZone
normalizeSchoolWeekdays
recalculateBossRewardTiers
resolveBattle
resolveBossAttack
resolveRecoverableBossAttack
resolveSharedBossAttack
resolveTeamBattle
reviveStudentPet
saveMentorDailyFeedbackForStudent
syncPetLifeState
toFiniteNumber
`.trim().split(/\s+/).sort();

test('legacy facade preserves the complete runtime export contract and identity', () => {
  const legacyRuntime = legacyRules as Record<string, unknown>;
  const domainRuntime = domainRules as Record<string, unknown>;

  assert.deepEqual(Object.keys(legacyRuntime).sort(), EXPECTED_RUNTIME_EXPORTS);
  assert.deepEqual(Object.keys(domainRuntime).sort(), EXPECTED_RUNTIME_EXPORTS);
  for (const exportName of EXPECTED_RUNTIME_EXPORTS) {
    assert.strictEqual(legacyRuntime[exportName], domainRuntime[exportName], exportName);
  }
  assert.equal('appendEconomyDelta' in domainRuntime, false);
});

test('game domain modules have no circular, legacy-facade, React, or Zustand dependencies', async () => {
  const domainDirectory = fileURLToPath(new URL('../src/domain/game/', import.meta.url));
  const filenames = (await readdir(domainDirectory))
    .filter((filename) => filename.endsWith('.ts'))
    .sort();
  const filenameSet = new Set(filenames);
  const graph = new Map<string, string[]>();

  for (const filename of filenames) {
    const sourceText = await readFile(`${domainDirectory}/${filename}`, 'utf8');
    const sourceFile = ts.createSourceFile(
      filename,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const dependencies: string[] = [];

    for (const statement of sourceFile.statements) {
      const moduleSpecifier =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined;
      if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;

      const specifier = moduleSpecifier.text;
      assert.equal(specifier.includes('gameRules'), false, `${filename} imports the legacy facade`);
      assert.equal(specifier === 'react', false, `${filename} imports React`);
      assert.equal(specifier === 'zustand', false, `${filename} imports Zustand`);
      if (filename !== 'index.ts') {
        assert.equal(specifier === './index', false, `${filename} imports the public barrel`);
      }

      if (!specifier.startsWith('./')) continue;
      const target = `${specifier.slice(2).replace(/\.(?:js|ts)$/, '')}.ts`;
      if (filenameSet.has(target)) dependencies.push(target);
    }

    graph.set(filename, dependencies);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (filename: string, path: string[]) => {
    if (visiting.has(filename)) {
      assert.fail(`Circular game-domain dependency: ${[...path, filename].join(' -> ')}`);
    }
    if (visited.has(filename)) return;

    visiting.add(filename);
    for (const dependency of graph.get(filename) ?? []) {
      visit(dependency, [...path, filename]);
    }
    visiting.delete(filename);
    visited.add(filename);
  };

  for (const filename of filenames) visit(filename, []);
});

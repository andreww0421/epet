import React from 'react';
import { PetActions } from '../features/pets/components/PetActions';
import { PetBadges } from '../features/pets/components/PetBadges';
import { PetCardHeader } from '../features/pets/components/PetCardHeader';
import { PetLearningRewardPanel } from '../features/pets/components/PetLearningRewardPanel';
import { PetVisual } from '../features/pets/components/PetVisual';
import { usePetCardStore } from '../features/pets/hooks/usePetCardStore';
import { usePetRecoveryClock } from '../features/pets/hooks/usePetRecoveryClock';
import { buildPetCardModel } from '../features/pets/model/petCardModel';
import { getPetStatusPresentation } from '../features/pets/presentation/petPresentation';
import type { GetClassroomRankInfo } from '../features/classroom/types';

type PetCardProps = {
  studentId: string;
  onBattle: (studentId: string) => void;
  onTeamUp: (studentId: string) => void;
  getRankInfo: GetClassroomRankInfo;
};

/**
 * Store-connected pet presentation and interaction shell.
 * All rule calculations live in gameRules and the pure pet-card model.
 */
export const PetCard = React.memo<PetCardProps>(({
  studentId,
  onBattle,
  onTeamUp,
  getRankInfo,
}) => {
  const {
    student,
    settings,
    activeBoss,
    classGoals,
    learningEvidence,
    animationMode,
    teammateName,
    actions,
  } = usePetCardStore(studentId);
  usePetRecoveryClock(student?.bossRecovery?.recoverAt);
  const headingId = React.useId();
  if (!student) return null;

  const model = buildPetCardModel({
    student,
    settings,
    bossIsActive: Boolean(activeBoss?.isActive),
    classGoals,
    learningEvidence,
    animationMode,
    teammateName,
    now: Date.now(),
  });

  const status = getPetStatusPresentation(
    model.language,
    model.pet.condition,
  );
  const rankInfo = getRankInfo(model.pet.rankPoints);

  return (
    <article
      className={`relative bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300 border-2 ${status.borderColor}`}
      aria-labelledby={headingId}
    >
      <PetCardHeader
        language={model.language}
        publicStudentName={model.publicStudentName}
        points={model.points}
        maxPoints={model.maxPoints}
        warningPoints={model.warningPoints}
        streak={model.streak}
        teammateName={model.teammateName}
        hasActivePenalty={model.hasActivePenalty}
        hasBossRecovery={model.hasBossRecovery}
        bossRecoveryMinutes={model.bossRecoveryMinutes}
        headingId={headingId}
        level={model.pet.level}
        borderColor={status.borderColor}
        backgroundColor={status.backgroundColor}
      />
      <PetLearningRewardPanel
        language={model.language}
        learning={model.learning}
      />
      <PetBadges badges={model.badges} language={model.language} />
      <PetVisual
        language={model.language}
        pet={model.pet}
        animation={model.animation}
        rankInfo={rankInfo}
        status={status}
      />
      <PetActions
        model={model}
        storeActions={actions}
        onBattle={onBattle}
        onTeamUp={onTeamUp}
      />
    </article>
  );
});

PetCard.displayName = 'PetCard';

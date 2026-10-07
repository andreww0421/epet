import { appendEconomyDelta } from './economyRules';
import { isPenaltyActive } from './penaltyRules';
import { isPetDead, syncPetLifeState } from './petRules';
import { clamp } from './ruleUtils';
import type { StudentRuleState } from './types';

export const applyFeedToStudent = <T extends StudentRuleState>(
  student: T,
  feedCost: number,
  feedGain: number,
  now = Date.now(),
  maxPoints = 700,
) => {
  if (isPetDead(student.pet)) {
    return student;
  }

  const nextStudent = {
    ...student,
    points: clamp(student.points - feedCost, 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...student.pet,
        fullness: clamp(student.pet.fullness + feedGain, 0, 100),
        happiness: clamp(
          student.pet.happiness + (isPenaltyActive(student.penaltyStatus, now) ? 5 : 10),
          0,
          100,
        ),
      },
      now,
    ),
  } as T;
  return appendEconomyDelta(student, nextStudent, 'feed', now);
};

export const applyPlayWithPet = <T extends StudentRuleState>(
  student: T,
  playCost: number,
  playGain: number,
  now = Date.now(),
  maxPoints = 700,
) => {
  if (isPetDead(student.pet)) {
    return student;
  }

  const nextStudent = {
    ...student,
    points: clamp(student.points - playCost, 0, maxPoints),
    pet: syncPetLifeState(
      {
        ...student.pet,
        happiness: clamp(student.pet.happiness + playGain, 0, 100),
      },
      now,
    ),
  } as T;
  return appendEconomyDelta(student, nextStudent, 'play', now);
};

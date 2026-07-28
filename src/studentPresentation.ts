import type { PublicNameMode } from './store/types';

export const getPublicStudentName = (
  name: string,
  mode: PublicNameMode = 'masked',
) => {
  const normalizedName = name.trim();
  if (mode === 'full' || !normalizedName) return normalizedName;

  return normalizedName
    .split(/\s+/)
    .map((part) => {
      const characters = Array.from(part);
      if (characters.length <= 1) return `${part}*`;
      return `${characters[0]}${'*'.repeat(Math.min(3, characters.length - 1))}`;
    })
    .join(' ');
};

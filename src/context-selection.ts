export type ContextCandidate = { file: string; characters: number; priority: number };

export function rankContext(candidates: ContextCandidate[], maxCharacters: number): string[] {
  const ranked = [...candidates].sort((a, b) => b.priority - a.priority || a.characters - b.characters);
  const selected: string[] = [];
  let used = 0;
  for (const candidate of ranked) {
    if (used + candidate.characters > maxCharacters) continue;
    selected.push(candidate.file);
    used += candidate.characters;
  }
  return selected;
}

import type { Letter } from '../doc/model';

export function firstBalloon(letters: Letter[], letter: Letter): Letter {
  const seen = new Set([letter.id]);
  while (letter.continuation) {
    const parent = letters.find((l) => l.id === letter.continuation!.after);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    letter = parent;
  }
  return letter;
}

export function balloonGroup(letters: Letter[], root: Letter): Letter[] {
  return [root, ...letters.filter((l) => l !== root && l.continuation && firstBalloon(letters, l) === root)];
}

export function captionGroups(letters: Letter[]): Letter[][] {
  const groups = new Map<Letter, Letter[]>();
  for (const l of letters) {
    const root = firstBalloon(letters, l);
    if (!groups.has(root)) groups.set(root, [root]);
    if (l !== root) groups.get(root)!.push(l);
  }
  return [...groups.values()];
}

export function balloonPaintOrder(group: Letter[]): Letter[] {
  const order: Letter[] = [];
  for (const l of group) {
    const parent = l.continuation?.join === 'stack' ? order.findIndex((p) => p.id === l.continuation!.after) : -1;
    order.splice(parent < 0 ? order.length : parent, 0, l);
  }
  return order;
}

export const groupWords = (group: Letter[]): string => group.map((l) => l.cap.text.trim()).filter(Boolean).join(' ');

/** Keep existing boundaries when possible. Earlier balloons keep their word counts on script edits. */
export function setGroupWords(group: Letter[], text: string): boolean {
  if (group.length === 1) {
    const l = group[0]!;
    if (l.cap.text === text) return false;
    l.cap = { ...l.cap, text };
    return true;
  }
  if (groupWords(group) === text) return false;
  let remaining = text.trim();
  group.forEach((l, i) => {
    const count = l.cap.text.trim().match(/\S+/g)?.length ?? 0;
    const words = [...remaining.matchAll(/\S+/g)];
    const end = i === group.length - 1 ? remaining.length : count ? (words[count]?.index ?? remaining.length) : 0;
    l.cap = { ...l.cap, text: remaining.slice(0, end).trimEnd() };
    remaining = remaining.slice(end).trimStart();
  });
  return true;
}

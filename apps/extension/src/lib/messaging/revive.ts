import type { Word, WireWord } from '../storage/types';

// Across the messaging boundary Dates arrive as ISO strings. These helpers
// turn a wire-format word back into one with real Date objects, so the rest
// of the app never has to care that the data took a trip through messaging.


export function reviveWord(wire: WireWord): Word {
  return {
    ...wire,
    createdAt: new Date(wire.createdAt),
    updatedAt: new Date(wire.updatedAt),
    deletedAt: wire.deletedAt === null ? null : new Date(wire.deletedAt),
    srsState: { ...wire.srsState, dueAt: new Date(wire.srsState.dueAt) },
  };
}

export function reviveWords(wires: WireWord[]): Word[] {
  return wires.map(reviveWord);
}

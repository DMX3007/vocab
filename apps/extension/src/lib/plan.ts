// Mirrors apps/api's PLANS.free.maxWords (see apps/api's plans.config.ts).
// Kept as a plain constant rather than importing the NestJS package into
// the extension bundle, but it's the single source of truth WITHIN the
// extension: both the real enforcement (Popup.tsx's handleAddWords) and
// the display (PlanPane.tsx) import this one value, so they can't drift
// apart from each other the way the two copies used to.
export const FREE_WORD_CAP = 500;

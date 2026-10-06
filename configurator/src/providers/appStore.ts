import { memoryStore } from 'ra-core';

/** One store for management and onboarding, so a language picked in one stays picked in the other. */
export const appStore = memoryStore();

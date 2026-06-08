import type { Terminbuchungen } from './app';

export type EnrichedTerminbuchungen = Terminbuchungen & {
  patientName: string;
};

// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Patienten {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    geburtsdatum?: string; // Format: YYYY-MM-DD oder ISO String
    telefonnummer?: string;
    email?: string;
  };
}

export interface Terminbuchungen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    patient?: string; // applookup -> URL zu 'Patienten' Record
    termin?: string; // Format: YYYY-MM-DD oder ISO String
    behandlungsraum?: LookupValue;
    bemerkungen?: string;
  };
}

export const APP_IDS = {
  PATIENTEN: '6a214a984f40c7c263b3488a',
  TERMINBUCHUNGEN: '6a214a9c6f620e33f3b2586e',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'terminbuchungen': {
    behandlungsraum: [{ key: "raum_2", label: "Raum 2" }, { key: "raum_3", label: "Raum 3" }, { key: "raum_1", label: "Raum 1" }],
  },
};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'patienten': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'geburtsdatum': 'date/date',
    'telefonnummer': 'string/tel',
    'email': 'string/email',
  },
  'terminbuchungen': {
    'patient': 'applookup/select',
    'termin': 'date/datetimeminute',
    'behandlungsraum': 'lookup/radio',
    'bemerkungen': 'string/textarea',
  },
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreatePatienten = StripLookup<Patienten['fields']>;
export type CreateTerminbuchungen = StripLookup<Terminbuchungen['fields']>;
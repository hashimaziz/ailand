export interface NpcIdentity {
  name: string;
  age: number;
}

export interface PersonalityProfile {
  traits: string[];
  speechStyle: string[];
  values: string[];
  dislikes: string[];
  /**
   * Example lines in this character's own voice.
   *
   * Small models imitate far more reliably than they obey abstract rules, so a
   * couple of concrete sentences do more for consistency than a paragraph of
   * adjectives. Kept short and bounded like the rest of the profile.
   */
  voiceExamples: string[];
  socialDisposition: number;
  trustBaseline: number;
}

export interface NpcState {
  locationId: string;
  mood: string;
  energy: number;
  stress: number;
  hunger: number;
  currentActivity: string;
  lastSimulatedAt: number;
}

export interface ScheduleBlock {
  startHour: number;
  endHour: number;
  locationId: string;
  activity: string;
}

export type Schedule = ScheduleBlock[];

export interface Npc {
  id: string;
  identity: NpcIdentity;
  personality: PersonalityProfile;
  biography: string;
  occupationId: string;
  homeLocationId: string;
  schedule: Schedule;
  state: NpcState;
}

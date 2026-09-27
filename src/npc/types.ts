export interface NpcIdentity {
  name: string;
  age: number;
}

export interface PersonalityProfile {
  traits: string[];
  speechStyle: string[];
  values: string[];
  dislikes: string[];
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

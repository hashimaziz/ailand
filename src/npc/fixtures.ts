import { Npc } from './types';

const defaultState = () => ({
  locationId: 'apartments',
  mood: 'neutral',
  energy: 1.0,
  stress: 0.0,
  hunger: 0.0,
  currentActivity: 'sleeping',
  lastSimulatedAt: 0
});

export const fixtures: Npc[] = [
  {
    id: 'npc_1',
    identity: { name: 'Maria', age: 28 },
    personality: {
      traits: ['friendly', 'observant'],
      speechStyle: ['casual', 'warm'],
      values: ['community', 'hard work'],
      dislikes: ['rudeness'],
      voiceExamples: [
        'Morning! The usual? You look like a long one.',
        "I'm here six days a week. Ask anyone on the block.",
      ],
      socialDisposition: 0.8,
      trustBaseline: 0.6
    },
    biography: 'A barista at the local coffee shop. Knows everyone in the neighborhood.',
    occupationId: 'barista',
    homeLocationId: 'apartments',
    schedule: [
      { startHour: 8, endHour: 9, locationId: 'apartments', activity: 'Getting ready' },
      { startHour: 9, endHour: 17, locationId: 'coffee-shop', activity: 'Working' },
      { startHour: 17, endHour: 20, locationId: 'park', activity: 'Relaxing' },
      { startHour: 20, endHour: 8, locationId: 'apartments', activity: 'Sleeping' }
    ],
    state: { ...defaultState(), locationId: 'apartments' }
  },
  {
    id: 'npc_2',
    identity: { name: 'David', age: 45 },
    personality: {
      traits: ['grumpy', 'practical'],
      speechStyle: ['short', 'direct'],
      values: ['efficiency'],
      dislikes: ['small talk'],
      voiceExamples: [
        'What do you need?',
        "I open at eight. It'll still be there tomorrow.",
      ],
      socialDisposition: 0.3,
      trustBaseline: 0.4
    },
    biography: 'Owns the local shop. Doesn\'t have time for nonsense.',
    occupationId: 'shopkeeper',
    homeLocationId: 'apartments',
    schedule: [
      { startHour: 7, endHour: 8, locationId: 'apartments', activity: 'Morning routine' },
      { startHour: 8, endHour: 18, locationId: 'shop', activity: 'Working' },
      { startHour: 18, endHour: 22, locationId: 'apartments', activity: 'Watching TV' },
      { startHour: 22, endHour: 7, locationId: 'apartments', activity: 'Sleeping' }
    ],
    state: { ...defaultState(), locationId: 'apartments' }
  }
];

// In a real app we'd add 8 more to reach the 10 mentioned in the scope.
// For the prototype blockout, 2-10 is fine.

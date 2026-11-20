import { timingSafeEqual } from 'node:crypto';
export const TEST_EMAILS = ['setarchitect-prototype-a@example.com', 'setarchitect-prototype-b@example.com'];
export function secretMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || expected.length < 40) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validTestUser(user) {
  return !!user && TEST_EMAILS.includes(user.email) && user.app_metadata?.setarchitect_environment === 'prototype-test';
}
export function assertSyntheticSave(input) {
  if (!input || typeof input.name !== 'string' || !input.name.startsWith('Prototype ') || !input.inputs?.eventName?.startsWith('Prototype ')) throw Error('Only named prototype events are accepted.');
  const songs = [...(input.inputs.songs ?? []), ...(input.lists?.warmUp ?? []), ...(input.lists?.transition ?? []), ...(input.lists?.peak ?? [])];
  if (songs.length > 200 || songs.some(s => !/^Prototype Artist \d{2}$/.test(s.artist) || !/^Test Track \d{2}$/.test(s.song))) throw Error('Only synthetic test tracks are accepted in saved test events.');
  // No real library or OS paths may enter the database; selections use portable test references.
  const walk = value => {
    if (typeof value === 'string' && (/\/Users\/|\/Volumes\/|[a-z]:\\/i.test(value) || /(?:service_role|sb_secret_|Bearer\s)/i.test(value))) throw Error('Private fields are not accepted.');
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(input);
}
const PUBLIC_TEST_TRACKS = [
  ['Earth, Wind & Fire', 'September'], ['Whitney Houston', 'I Wanna Dance with Somebody'],
  ['Mark Ronson feat. Bruno Mars', 'Uptown Funk'], ['ABBA', 'Dancing Queen'],
  ['Stevie Wonder', 'Superstition'], ['Dua Lipa', "Don't Start Now"],
];
export function assertTestLookup(input) {
  // A small public-catalogue fixture is allowed for genuine provider checks. No
  // real client brief, library index, or event details are needed for these checks.
  const songs = input?.songs ?? (input?.artist ? [{ artist: input.artist, song: input.song ?? input.title }] : []);
  for (const s of songs) {
    const synthetic = /^Prototype Artist \d{2}$/.test(s.artist) && /^Test Track \d{2}$/.test(s.song ?? '');
    const known = PUBLIC_TEST_TRACKS.some(([a, t]) => a.toLowerCase() === String(s.artist).toLowerCase() && t.toLowerCase() === String(s.song).toLowerCase());
    if (!synthetic && !known) throw Error('Only the synthetic or public catalogue test fixture is accepted.');
  }
}

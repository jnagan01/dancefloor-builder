import type { QualitySample } from '@/lib/prep/quality';

/**
 * SYNTHETIC REGRESSION BENCHMARK — NOT USER JUDGMENTS.
 * Invented artists and invented ratings that encode the intended evidence ordering, so ranking revisions
 * can be compared deterministically. Passing these proves nothing about real-world recommendation accuracy.
 */
export const SYNTHETIC_NOTICE = 'synthetic fixture, not user judgments';

export const syntheticEvidenceSample: QualitySample = {
  id: 'synthetic-evidence', name: `Evidence ladder (${SYNTHETIC_NOTICE})`, createdAt: 0,
  requests: [{ artist: 'Seed Act One', song: 'Seed One', genre: 'House', decade: '2010s' }, { artist: 'Seed Act Two', song: 'Seed Two', genre: 'House', decade: '2010s' }],
  preferences: { genres: ['House'], decades: [], artists: [] }, eventTags: ['singalong'],
  // Deliberately listed weakest-first so the captured order is the worst possible order.
  candidates: [
    { artist: 'Nothing Act', song: 'No Evidence', origin: 'catalogue', rating: 'poor' },
    { artist: 'Guess Act', song: 'AI Genre Guess', origin: 'ai', genre: 'House', genreSource: 'ai', rating: 'poor' },
    { artist: 'Tag Act', song: 'File Tag House', origin: 'library', genre: 'House', genreSource: 'tags', owned: true, rating: 'maybe' },
    { artist: 'Neighbour Act', song: 'Artist Similar', origin: 'library', owned: true, similarTo: 'Seed Act One', similarMatch: 0.8, rating: 'maybe' },
    { artist: 'Single Act', song: 'One Seed Similar', origin: 'library', owned: true, lastfmSeeds: ['Seed Act One – Seed One'], lastfmMatch: 0.6, rating: 'good' },
    { artist: 'Double Act', song: 'Two Seeds Similar', origin: 'library', owned: true, lastfmSeeds: ['Seed Act One – Seed One', 'Seed Act Two – Seed Two'], lastfmMatch: 0.6, rating: 'good' },
  ],
};

/** Same artist three times: variety should interleave other artists before the third copy. */
export const syntheticVarietySample: QualitySample = {
  id: 'synthetic-variety', name: `Artist variety (${SYNTHETIC_NOTICE})`, createdAt: 0,
  requests: [{ artist: 'Seed Act One', song: 'Seed One' }], preferences: { genres: [], decades: [], artists: [] }, eventTags: [],
  candidates: [
    { artist: 'Repeat Act', song: 'A', origin: 'library', similarTo: 'Seed Act One', similarMatch: 0.9, rating: 'good' },
    { artist: 'Repeat Act', song: 'B', origin: 'library', similarTo: 'Seed Act One', similarMatch: 0.9, rating: 'maybe' },
    { artist: 'Repeat Act', song: 'C', origin: 'library', similarTo: 'Seed Act One', similarMatch: 0.9, rating: 'poor' },
    { artist: 'Other Act', song: 'D', origin: 'library', similarTo: 'Seed Act One', similarMatch: 0.7, rating: 'good' },
  ],
};

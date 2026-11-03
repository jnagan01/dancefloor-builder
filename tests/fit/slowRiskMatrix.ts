/** Predetermined, held-out generic boundaries; no real names, ratings or tuning feedback. */
import type { Candidate, RecInput } from "../../src/lib/prep/recommend";
import { DEFAULT_REC_CONTROLS } from "../../src/lib/prep/recommend";
import { songIdentity } from "../../src/lib/prep/knowledge";
export const matrix: Candidate[] = [
  { artist: "TEST Risk", song: "A", origin: "ai", facts: {}, fit: { energy: 4, danceability: 4, energySource: "ai", danceabilitySource: "ai", popularity: 10, popularitySource: "estimate" } },
  { artist: "TEST Supported", song: "B", origin: "ai", facts: {}, fit: { energy: 7, danceability: 7, energySource: "provider", danceabilitySource: "provider" } },
  { artist: "TEST Strong", song: "C", origin: "library", facts: { owned: true }, fit: { energy: 4, danceability: 4, energySource: "tags", danceabilitySource: "provider" } },
  { artist: "TEST Groove", song: "D", origin: "ai", facts: { bpm: 65 }, fit: { energy: 3, danceability: 8, energySource: "provider", danceabilitySource: "ai" } },
  { artist: "TEST Conflict", song: "E", origin: "ai", facts: {}, fit: { energy: 8, danceability: 3, energySource: "ai", danceabilitySource: "tags" } },
  { artist: "TEST Unknown", song: "F", origin: "ai", facts: { bpm: 55 }, fit: { popularity: 10, popularitySource: "estimate" } },
  { artist: "TEST Recognition", song: "G", origin: "ai", facts: {}, fit: { energy: 4, danceability: 4, energySource: "estimate", danceabilitySource: "estimate", popularity: 10, popularitySource: "provider" } },
  { artist: "TEST Boundary", song: "H", origin: "ai", facts: {}, fit: { energy: 4.01, danceability: 4, energySource: "ai", danceabilitySource: "ai" } },
  { artist: "TEST Moderate", song: "I", origin: "ai", facts: {}, fit: { energy: 6, danceability: 6, energySource: "estimate", danceabilitySource: "estimate", popularity: 8, popularitySource: "estimate" } },
  { artist: "TEST Supported Estimate", song: "J", origin: "ai", facts: {}, fit: { energy: 5, danceability: 7, energySource: "catalogue", danceabilitySource: "estimate", popularity: 8, popularitySource: "estimate" } },
];
export function matrixInput(candidates = matrix): RecInput {
  return { candidates, requests: [{ artist: "TEST Request", song: "Keep (Live)" }], inEvent: [{ artist: "TEST Request", song: "Keep (Live)" }], feedback: [], dismissed: [],
    similarTracks: candidates.map(c => ({ key: songIdentity(c.artist, c.song), artist: c.artist, song: c.song, bestMatch: c.song === "B" ? 0.5 : 1, seeds: c.song === "A" || c.song === "G" ? ["Seed 1", "Seed 2", "Seed 3", "Seed 4"] : ["Seed 1"] })),
    preferences: { fit: { familiarity: "familiar", avoidSlow: true } }, controls: { ...DEFAULT_REC_CONTROLS, artistVariety: 0 }, limit: 99 };
}
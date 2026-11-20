import { getWorkflow, listWorkflows, saveWorkflowSafely } from '@/lib/history.functions';
import { enrichSongs } from '@/lib/enrich.functions';
import { lookupCommunityBatch } from '@/lib/prep/community.functions';
import { lookupMusicBrainz, lookupLastfmTrack } from '@/lib/prep/lookup.functions';
import { getArtistCrowdData, getSimilarTracks } from '@/lib/lastfm.functions';
import { getArtistNeighbors } from '@/lib/neighbors.functions';
import { recommendSongsForSection } from '@/lib/recommend.functions';
export const handlers = { getWorkflow, listWorkflows, saveWorkflowSafely, enrichSongs, lookupCommunityBatch, lookupMusicBrainz, lookupLastfmTrack, getArtistCrowdData, getSimilarTracks, getArtistNeighbors, recommendSongsForSection };

CREATE TABLE public.song_metadata_cache (
  artist_key text NOT NULL,
  song_key text NOT NULL,
  energy real,
  danceability real,
  valence real,
  popularity real,
  bpm real,
  camelot text,
  musical_key text,
  genre text,
  year integer,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_key, song_key)
);

GRANT SELECT ON public.song_metadata_cache TO authenticated;
GRANT ALL ON public.song_metadata_cache TO service_role;

ALTER TABLE public.song_metadata_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cached song metadata"
  ON public.song_metadata_cache FOR SELECT
  TO authenticated
  USING (true);
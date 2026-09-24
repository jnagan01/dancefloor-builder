ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dj_alias text,
  ADD COLUMN IF NOT EXISTS default_hours text NOT NULL DEFAULT '3',
  ADD COLUMN IF NOT EXISTS default_decades text[] NOT NULL DEFAULT ARRAY['2000s','2010s','2020s']::text[],
  ADD COLUMN IF NOT EXISTS default_expand boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favorite_artists text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS library_name text,
  ADD COLUMN IF NOT EXISTS library_track_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS library_synced_at timestamp with time zone;
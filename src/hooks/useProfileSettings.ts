import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProfileSettings {
  display_name: string | null;
  dj_alias: string | null;
  default_hours: string;
  default_decades: string[];
  default_expand: boolean;
  favorite_artists: string;
  library_name: string | null;
  library_track_count: number;
  library_synced_at: string | null;
}

const COLUMNS =
  "display_name, dj_alias, default_hours, default_decades, default_expand, favorite_artists, library_name, library_track_count, library_synced_at";

export function useProfileSettings() {
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data } = await supabase.from("profiles").select(COLUMNS).eq("id", user.id).maybeSingle();
      if (cancelled) return;
      if (data) setSettings(data as ProfileSettings);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (patch: Partial<ProfileSettings>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    if (error) return false;
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    return true;
  }, []);

  return { settings, loading, save };
}

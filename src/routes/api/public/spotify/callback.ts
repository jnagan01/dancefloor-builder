import { createFileRoute } from "@tanstack/react-router";
import { verifyState, redirectUriFor, SPOTIFY_SCOPES } from "@/lib/spotifyExport.functions";

function back(origin: string, status: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin.replace(/\/$/, "")}/settings?spotify=${status}#spotify` },
  });
}

export const Route = createFileRoute("/api/public/spotify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env["SPOTIFY_CLIENT_ID"];
        const clientSecret = process.env["SPOTIFY_CLIENT_SECRET"];
        if (!clientId || !clientSecret) return new Response("Spotify is not configured", { status: 500 });

        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "";
        const verified = await verifyState(state, clientSecret);
        if (!verified) return new Response("Invalid or expired sign-in request", { status: 400 });

        const { userId, origin } = verified;
        if (url.searchParams.get("error")) return back(origin, "denied");
        const code = url.searchParams.get("code");
        if (!code) return back(origin, "error");

        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUriFor(origin),
          }).toString(),
        });
        if (!tokenRes.ok) return back(origin, "error");
        const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
        if (!tokens.access_token || !tokens.refresh_token) return back(origin, "error");

        const meRes = await fetch("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!meRes.ok) return back(origin, "error");
        const me = (await meRes.json()) as { id?: string; display_name?: string };
        if (!me.id) return back(origin, "error");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("spotify_connections").upsert(
          {
            user_id: userId,
            spotify_user_id: me.id,
            spotify_display_name: me.display_name ?? me.id,
            refresh_token: tokens.refresh_token,
            scopes: SPOTIFY_SCOPES,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (error) return back(origin, "error");
        return back(origin, "connected");
      },
    },
  },
});

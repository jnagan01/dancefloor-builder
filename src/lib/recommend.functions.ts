import { createServerFn } from "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SectionEnum = z.enum(["Warm Up", "Transition", "Peak"]);

const InputSchema = z.object({
  section: SectionEnum,
  count: z.number().int().min(1).max(40),
  prefs: z.object({
    artists: z.array(z.string()).max(50).default([]),
    genres: z.array(z.string()).max(50).default([]),
    decades: z.array(z.string()).max(20).default([]),
    notes: z.string().max(2000).default(""),
    doNotPlay: z
      .array(z.object({ artist: z.string().optional(), song: z.string().optional() }))
      .max(500)
      .default([]),
  }),
  existing: z
    .array(z.object({ artist: z.string(), song: z.string() }))
    .max(500)
    .default([]),
});

const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      artist: z.string(),
      song: z.string(),
      genre: z.string(),
      decade: z.string(),
      energy: z.number(),
      danceability: z.number(),
      popularity: z.number(),
      valence: z.number(),
      reason: z.string(),
    }),
  ),
});

export type RecommendedSong = z.infer<typeof SuggestionSchema>["suggestions"][number];

export const recommendSongsForSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const sectionGuide: Record<string, string> = {
      "Warm Up":
        "LOWER energy (3–6) and mid danceability (5–7). High popularity singalongs and warm/positive valence (6–9). Songs that get people on the floor without going full peak — disco, funk, soul, oldies, feel-good classics.",
      Transition:
        "MID-TO-HIGH energy (6–8) and high danceability (7–9). High popularity crowd-pleasers, valence 6–9. Modern pop, alt, 2000s/2010s hits that bridge warm-up into peak.",
      Peak:
        "HIGH energy (8–10) and high-to-max danceability (8–10). Euphoric or high-arousal valence (6–10). Peak-time bangers (EDM, hip hop, party anthems) to maximize the dance floor.",
    };

    const existingList = data.existing
      .slice(0, 200)
      .map((s) => `${s.artist} — ${s.song}`)
      .join("\n");
    const blockList = data.prefs.doNotPlay
      .slice(0, 100)
      .map((b) => `${b.artist ?? ""} — ${b.song ?? ""}`.trim())
      .filter(Boolean)
      .join("\n");

    const prompt = `You are an expert wedding/party DJ. Suggest ${data.count} real released songs for the "${data.section}" portion of a dance floor set.

Section targets: ${sectionGuide[data.section]}

You score every track on FOUR signals (integers 1–10) and pick songs whose scores match the target band above. These signals are the PRIMARY basis for your picks — not just artist popularity or genre matching:
- energy: arousal / intensity / tempo + loudness perception
- danceability: how rhythmically suited to dancing
- popularity: how widely the song is recognized by a general wedding/party crowd (10 = everyone sings along, 1 = obscure)
- valence: musical positivity (10 = euphoric/happy, 1 = sad/dark)

IMPORTANT: You are NOT limited to any built-in library. Recommend the songs that best fit the section targets — they can be deep cuts, recent releases, or international hits, as long as they are real released songs you are confident exist. Match the section by SCORES first; preference matching second.

DJ preferences (use as bias, not as a hard filter):
- Preferred artists: ${data.prefs.artists.join(", ") || "(none specified)"}
- Preferred genres: ${data.prefs.genres.join(", ") || "(none specified)"}
- Preferred decades: ${data.prefs.decades.join(", ") || "(any)"}
- Notes from DJ: ${data.prefs.notes || "(none)"}

Already in the set (do NOT suggest these or near-duplicates):
${existingList || "(none)"}

Do NOT play (avoid these artists/songs):
${blockList || "(none)"}

Rules:
- Suggest REAL released songs you are confident exist; no fabrications.
- Every score (energy, danceability, popularity, valence) is an integer 1–10 and MUST sit inside the section target band above.
- decade is like "1970s", "1980s", "2010s", "2020s".
- Keep reason to one short sentence that references the four signals (e.g. "high energy 9, dance 9, popularity 10, euphoric valence 9 — instant peak").
- Return exactly ${data.count} suggestions.`;

    const result = await generateObject({
      model: gateway("google/gemini-3-flash-preview"),
      schema: SuggestionSchema,
      prompt,
    });

    return { suggestions: result.object.suggestions };
  });

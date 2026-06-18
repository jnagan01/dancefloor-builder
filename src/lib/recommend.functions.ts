import { createServerFn } from "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";

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
      reason: z.string(),
    }),
  ),
});

export type RecommendedSong = z.infer<typeof SuggestionSchema>["suggestions"][number];

export const recommendSongsForSection = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const sectionGuide: Record<string, string> = {
      "Warm Up":
        "Lower-to-mid energy crowd-pleasers (disco, funk, soul, oldies, singalongs) that get people moving without going full peak.",
      Transition:
        "Mid-to-high energy modern pop, alt, and 2000s/2010s hits that bridge warm-up into peak.",
      Peak:
        "High-energy peak-time bangers (EDM, hip hop, party anthems) to maximize the dance floor.",
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

    const prompt = `You are an expert wedding/party DJ. Suggest ${data.count} real, well-known songs for the "${data.section}" portion of a dance floor set.

Section guidance: ${sectionGuide[data.section]}

DJ preferences:
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
- Prefer songs that fit the DJ's preferences when present.
- energy and danceability are integers 1–10.
- decade is like "1970s", "1980s", "2010s", "2020s".
- Keep reason to one short sentence.
- Return exactly ${data.count} suggestions.`;

    const result = await generateObject({
      model: gateway("google/gemini-3-flash-preview"),
      schema: SuggestionSchema,
      prompt,
    });

    return { suggestions: result.object.suggestions };
  });

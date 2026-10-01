import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ReportErrorInput {
  severity?: "major" | "minor";
  category?: string;
  message: string;
  stack?: string;
  context?: Record<string, string>;
}

/** Quietly records a problem seen in the app. Returns nothing useful by design. */
export const reportAppError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ReportErrorInput) => ({
    severity: input.severity === "major" ? ("major" as const) : ("minor" as const),
    category: String(input.category ?? "runtime").slice(0, 60),
    message: String(input.message ?? "Unknown error").slice(0, 500),
    stack: input.stack ? String(input.stack).slice(0, 4000) : undefined,
    context: Object.fromEntries(
      Object.entries(input.context ?? {})
        .slice(0, 12)
        .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 200)]),
    ),
  }))
  .handler(async ({ data, context }) => {
    const { logAppError } = await import("@/lib/errorLog.server");
    await logAppError({ ...data, userId: context.userId });
    return { ok: true };
  });

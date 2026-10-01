// Server-only: quietly records app problems and fires an immediate email for
// major issues. No UI reads this table; the weekly digest and instant alerts
// are the only consumers.

import { sendTemplateEmail } from "@/lib/email-templates/send-email";

export type ErrorSeverity = "major" | "minor";

export interface LoggedError {
  severity?: ErrorSeverity;
  category?: string;
  message: string;
  stack?: string | undefined;
  context?: Record<string, unknown>;
  userId?: string | undefined;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
/** One instant alert per distinct failure every 15 minutes. */
const ALERT_WINDOW_MINUTES = 15;

function fingerprintOf(category: string, message: string) {
  return `${category}:${message.slice(0, 160).replace(/\d+/g, "#").toLowerCase()}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function logAppError(entry: LoggedError): Promise<void> {
  try {
    // Visitors closing a tab or refreshing mid-request are not app failures.
    const CLIENT_ABORT = /^(aborted|AbortError|The operation was aborted|.*ECONNRESET.*|socket hang up|.*client (disconnected|closed).*)$/i;
    if (CLIENT_ABORT.test(String(entry.message ?? "")) || /abortIncoming|socketOnClose/.test(entry.stack ?? "")) return;
    const severity: ErrorSeverity = entry.severity ?? "minor";
    const category = (entry.category ?? "runtime").slice(0, 60);
    const message = String(entry.message ?? "Unknown error").slice(0, MAX_MESSAGE);
    const stack = entry.stack ? String(entry.stack).slice(0, MAX_STACK) : null;
    const fingerprint = fingerprintOf(category, message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inserted, error } = await supabaseAdmin
      .from("app_errors")
      .insert({
        severity,
        category,
        message,
        stack,
        fingerprint,
        context: (entry.context ?? {}) as never,
        user_id: entry.userId ?? null,
      })
      .select("id, created_at")
      .single();

    if (error || !inserted) return;
    if (severity !== "major") return;

    // Alert storm guard: skip if the same failure already alerted recently.
    const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("app_errors")
      .select("id", { count: "exact", head: true })
      .eq("fingerprint", fingerprint)
      .not("alerted_at", "is", null)
      .gte("alerted_at", since);

    if ((count ?? 0) > 0) return;

    await supabaseAdmin
      .from("app_errors")
      .update({ alerted_at: new Date().toISOString() })
      .eq("id", inserted.id);

    const contextText = Object.entries(entry.context ?? {})
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(" · ")
      .slice(0, 400);

    await sendTemplateEmail("critical-error-alert", "", {
      templateData: {
        message,
        category,
        occurredAt: formatTime(inserted.created_at),
        context: contextText,
        stack: stack ?? "",
      },
      idempotencyKey: `critical-error-alert-${inserted.id}`,
    });
  } catch {
    // Never let logging break the request it is reporting on.
  }
}

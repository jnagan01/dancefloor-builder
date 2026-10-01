import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { sendTemplateEmail } from "@/lib/email-templates/send-email";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function fmtDay(d: Date) {
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const Route = createFileRoute("/api/public/hooks/weekly-error-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["ERROR_DIGEST_CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!secret || !provided || !safeEqual(provided, secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = new Date();
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const { data, error } = await supabaseAdmin
          .from("app_errors")
          .select("severity, category, message, created_at")
          .gte("created_at", start.toISOString())
          .order("created_at", { ascending: false })
          .limit(2000);

        if (error) {
          return new Response(JSON.stringify({ success: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const rows = data ?? [];
        const majorCount = rows.filter((r) => r.severity === "major").length;

        const grouped = new Map<
          string,
          { message: string; category: string; severity: string; count: number; lastSeen: string }
        >();
        for (const r of rows) {
          const key = `${r.category}|${r.message}`;
          const existing = grouped.get(key);
          if (existing) {
            existing.count += 1;
            if (r.severity === "major") existing.severity = "major";
          } else {
            grouped.set(key, {
              message: r.message,
              category: r.category,
              severity: r.severity,
              count: 1,
              lastSeen: fmtTime(r.created_at),
            });
          }
        }

        const groups = [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 12);

        await sendTemplateEmail("weekly-error-digest", "", {
          templateData: {
            weekLabel: `${fmtDay(start)} – ${fmtDay(now)}`,
            total: rows.length,
            majorCount,
            minorCount: rows.length - majorCount,
            groups,
          },
          idempotencyKey: `weekly-error-digest-${now.toISOString().slice(0, 10)}`,
        });

        return new Response(JSON.stringify({ success: true, total: rows.length }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

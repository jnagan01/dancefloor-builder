import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

export interface DigestGroup {
  message: string;
  category: string;
  severity: string;
  count: number;
  lastSeen: string;
}

interface Props {
  weekLabel?: string;
  total?: number;
  majorCount?: number;
  minorCount?: number;
  groups?: DigestGroup[];
}

const Email = ({
  weekLabel = "the past 7 days",
  total = 0,
  majorCount = 0,
  minorCount = 0,
  groups = [],
}: Props) => {
  const allClear = total === 0;
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {allClear
          ? `All clear — no issues recorded for ${weekLabel}`
          : `${total} issue${total === 1 ? "" : "s"} recorded for ${weekLabel}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={eyebrow}>SetArchitect</Text>
          <Heading style={heading}>Weekly status report</Heading>
          <Text style={muted}>{weekLabel}</Text>

          {allClear ? (
            <Section style={allClearBox}>
              <Text style={allClearTitle}>All clear</Text>
              <Text style={allClearText}>
                No issues were recorded this week. Everything ran as expected.
              </Text>
            </Section>
          ) : (
            <>
              <Section style={statsBox}>
                <Text style={statLine}>
                  <strong>{total}</strong> total · <strong>{majorCount}</strong> major ·{" "}
                  <strong>{minorCount}</strong> minor
                </Text>
              </Section>

              <Hr style={hr} />
              <Heading as="h2" style={subheading}>
                Most frequent issues
              </Heading>

              {groups.map((g, i) => (
                <Section key={i} style={row}>
                  <Text style={rowTitle}>
                    {g.count}× · {g.severity === "major" ? "Major" : "Minor"} · {g.category}
                  </Text>
                  <Text style={rowMessage}>{g.message}</Text>
                  <Text style={rowMeta}>Last seen {g.lastSeen}</Text>
                </Section>
              ))}
            </>
          )}

          <Hr style={hr} />
          <Text style={footer}>
            Sent automatically every Monday morning by SetArchitect.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    (data["total"] ?? 0) === 0
      ? "SetArchitect — weekly report: all clear"
      : `SetArchitect — weekly report: ${data["total"]} issue${data["total"] === 1 ? "" : "s"}`,
  displayName: "Weekly error digest",
  to: "joe@exceptional-entertainment.com",
  previewData: {
    weekLabel: "Sep 22 – Sep 29, 2026",
    total: 3,
    majorCount: 1,
    minorCount: 2,
    groups: [
      {
        message: "AI recommendation request failed",
        category: "ai",
        severity: "major",
        count: 2,
        lastSeen: "Sep 28, 7:12 PM",
      },
      {
        message: "Song metadata lookup timed out",
        category: "enrichment",
        severity: "minor",
        count: 1,
        lastSeen: "Sep 25, 2:03 PM",
      },
    ],
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { padding: "28px 26px", maxWidth: "600px" };
const eyebrow = {
  fontSize: "12px",
  letterSpacing: "1.5px",
  textTransform: "uppercase" as const,
  color: "#9a7b3f",
  margin: "0 0 6px",
};
const heading = { fontSize: "24px", color: "#17181c", margin: "0 0 4px" };
const subheading = { fontSize: "16px", color: "#17181c", margin: "0 0 10px" };
const muted = { fontSize: "14px", color: "#6b6f76", margin: "0 0 20px" };
const allClearBox = {
  backgroundColor: "#f1f8f2",
  border: "1px solid #cfe6d4",
  borderRadius: "10px",
  padding: "18px 20px",
};
const allClearTitle = { fontSize: "16px", color: "#1f6b36", margin: "0 0 6px", fontWeight: 700 };
const allClearText = { fontSize: "14px", color: "#3f4a42", margin: 0 };
const statsBox = {
  backgroundColor: "#f7f7f8",
  border: "1px solid #e6e6e9",
  borderRadius: "10px",
  padding: "16px 20px",
};
const statLine = { fontSize: "15px", color: "#17181c", margin: 0 };
const row = {
  borderLeft: "3px solid #e0c178",
  padding: "4px 0 4px 14px",
  margin: "0 0 16px",
};
const rowTitle = { fontSize: "13px", color: "#9a7b3f", margin: "0 0 4px", fontWeight: 700 };
const rowMessage = { fontSize: "14px", color: "#17181c", margin: "0 0 4px" };
const rowMeta = { fontSize: "12px", color: "#6b6f76", margin: 0 };
const hr = { borderColor: "#e6e6e9", margin: "24px 0" };
const footer = { fontSize: "12px", color: "#8a8f98", margin: 0 };

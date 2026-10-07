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

interface Props {
  message?: string;
  category?: string;
  occurredAt?: string;
  context?: string;
  stack?: string;
}

const Email = ({
  message = "An unexpected error occurred",
  category = "runtime",
  occurredAt = "",
  context = "",
  stack = "",
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Major issue: ${message}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>SetArchitect</Text>
        <Heading style={heading}>Major issue detected</Heading>

        <Section style={alertBox}>
          <Text style={alertMessage}>{message}</Text>
          <Text style={alertMeta}>
            {category}
            {occurredAt ? ` · ${occurredAt}` : ""}
          </Text>
        </Section>

        {context ? (
          <>
            <Heading as="h2" style={subheading}>
              Where it happened
            </Heading>
            <Text style={body}>{context}</Text>
          </>
        ) : null}

        {stack ? (
          <>
            <Heading as="h2" style={subheading}>
              Technical detail
            </Heading>
            <Text style={code}>{stack}</Text>
          </>
        ) : null}

        <Hr style={hr} />
        <Text style={footer}>
          You get this message only for major issues. Everything else appears in the
          Monday summary.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `SetArchitect — major issue: ${String(data["message"] ?? "unexpected error").slice(0, 80)}`,
  displayName: "Critical error alert",
  to: "joe@exceptional-entertainment.com",
  previewData: {
    message: "VirtualDJ export failed to write playlist",
    category: "export",
    occurredAt: "Sep 30, 7:14 PM",
    context: "Event builder · step 5 · export all",
    stack: "Error: EACCES permission denied",
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
const heading = { fontSize: "24px", color: "#17181c", margin: "0 0 18px" };
const subheading = { fontSize: "15px", color: "#17181c", margin: "20px 0 6px" };
const alertBox = {
  backgroundColor: "#fdf2f2",
  border: "1px solid #f0cfcf",
  borderRadius: "10px",
  padding: "16px 20px",
};
const alertMessage = { fontSize: "16px", color: "#8c2f2f", margin: "0 0 6px", fontWeight: 700 };
const alertMeta = { fontSize: "12px", color: "#6b6f76", margin: 0 };
const body = { fontSize: "14px", color: "#17181c", margin: 0 };
const code = {
  fontSize: "12px",
  fontFamily: "Menlo, Consolas, monospace",
  color: "#3f4450",
  backgroundColor: "#f7f7f8",
  border: "1px solid #e6e6e9",
  borderRadius: "8px",
  padding: "12px 14px",
  margin: 0,
  whiteSpace: "pre-wrap" as const,
};
const hr = { borderColor: "#e6e6e9", margin: "24px 0" };
const footer = { fontSize: "12px", color: "#8a8f98", margin: 0 };

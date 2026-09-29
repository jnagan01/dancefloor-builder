export function pageHead(title: string, description: string) {
  return { meta: [
    { title: `${title} — Dancefloor Builder` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Dancefloor Builder` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] };
}

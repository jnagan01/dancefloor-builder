export function pageHead(title: string, description: string) {
  return { meta: [
    { title: `${title} — SetArchitect` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — SetArchitect` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] };
}

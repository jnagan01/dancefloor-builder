/** Render an "artist|title" label as one Markdown table cell: the first pipe becomes the
 * " – " separator (preserving existing report text); every remaining pipe is escaped and
 * line breaks collapse to spaces so no value can split or add table cells/rows. */
export function trackCell(label: string): string {
  const i = label.indexOf("|");
  const joined = i < 0 ? label : `${label.slice(0, i)} – ${label.slice(i + 1)}`;
  return joined.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, " ");
}

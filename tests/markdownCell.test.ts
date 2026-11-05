import { describe, expect, it } from "vitest";
import { trackCell } from "./fit/markdownCell";

const cells = (row: string) => row.split(/(?<!\\)\|/).length;

describe("report track cell escaping", () => {
  it("keeps the existing artist – title text for ordinary labels", () => {
    expect(trackCell("Bee Gees|Stayin' Alive")).toBe("Bee Gees – Stayin' Alive");
  });
  it("escapes every additional pipe so the table keeps its columns", () => {
    const out = trackCell("A|B|C|D");
    expect(out).toBe("A – B\\|C\\|D");
    expect(cells(`| ${out} | 1 |`)).toBe(cells("| x | 1 |"));
  });
  it("collapses line breaks so a label cannot start a new row", () => {
    expect(trackCell("A|Line1\nLine2\r\nLine3")).toBe("A – Line1 Line2 Line3");
  });
  it("escapes backslashes before pipes so an escape cannot be undone", () => {
    expect(trackCell("A|x\\|y")).toBe("A – x\\\\\\|y");
  });
});

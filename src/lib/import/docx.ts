import JSZip from "jszip";

/**
 * Reads a Word (.docx) file into plain text, one line per paragraph, so the plain-text question
 * parser can read it. Word's automatic lists are written out as text: lettered lists become
 * "A.", "B."… and numbered lists "1.", "2."…, so teachers can use either typed or automatic letters.
 */
export async function docxToText(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const doc = await zip.file("word/document.xml")?.async("string");
  if (!doc) throw new Error("This doesn't look like a Word document.");
  const numbering = await zip.file("word/numbering.xml")?.async("string");
  const formats = numberingFormats(numbering ?? "");

  const xml = new DOMParser().parseFromString(doc, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines: string[] = [];
  const counters = new Map<string, number>();
  let lastList: string | null = null;

  for (const p of Array.from(xml.getElementsByTagNameNS(W, "p"))) {
    let text = "";
    for (const node of Array.from(p.getElementsByTagNameNS(W, "*"))) {
      if (node.localName === "t") text += node.textContent ?? "";
      else if (node.localName === "tab") text += " ";
      else if (node.localName === "br") text += "\n";
    }
    text = text.replace(/ /g, " ").trim();

    const numPr = p.getElementsByTagNameNS(W, "numPr")[0];
    if (numPr && text) {
      const numId = numPr.getElementsByTagNameNS(W, "numId")[0]?.getAttributeNS(W, "val") ?? "";
      const ilvl = numPr.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val") ?? "0";
      const key = `${numId}:${ilvl}`;
      const fmt = formats.get(key) ?? "decimal";
      if (fmt.includes("Letter")) {
        // Lettered options restart for each question (a new run of the list after other paragraphs).
        if (lastList !== key) counters.set(key, 0);
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        text = `${String.fromCharCode(64 + Math.min(n, 26))}. ${text}`;
      } else if (fmt !== "bullet") {
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        text = `${n}. ${text}`;
      }
      lastList = key;
    } else if (text) {
      lastList = null;
    }
    lines.push(text);
  }
  return lines.join("\n");
}

/** numId:level → number format ("decimal", "upperLetter", "lowerLetter", "bullet"…). */
function numberingFormats(xmlText: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!xmlText) return out;
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const abstract = new Map<string, Map<string, string>>();
  for (const a of Array.from(xml.getElementsByTagNameNS(W, "abstractNum"))) {
    const levels = new Map<string, string>();
    for (const lvl of Array.from(a.getElementsByTagNameNS(W, "lvl"))) {
      const fmt = lvl.getElementsByTagNameNS(W, "numFmt")[0]?.getAttributeNS(W, "val") ?? "decimal";
      levels.set(lvl.getAttributeNS(W, "ilvl") ?? "0", fmt);
    }
    abstract.set(a.getAttributeNS(W, "abstractNumId") ?? "", levels);
  }
  for (const num of Array.from(xml.getElementsByTagNameNS(W, "num"))) {
    const numId = num.getAttributeNS(W, "numId") ?? "";
    const absId = num.getElementsByTagNameNS(W, "abstractNumId")[0]?.getAttributeNS(W, "val") ?? "";
    for (const [lvl, fmt] of abstract.get(absId) ?? []) out.set(`${numId}:${lvl}`, fmt);
  }
  return out;
}

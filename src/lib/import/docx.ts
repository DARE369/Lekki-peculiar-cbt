import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// Word's "Insert → Symbol" stores characters from the Symbol font as private codes (F0xx).
const SYMBOL_FONT: Record<number, string> = {
  0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6a: "ϕ",
  0x6b: "κ", 0x6c: "λ", 0x6d: "μ", 0x6e: "ν", 0x6f: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ",
  0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ", 0x44: "Δ", 0x46: "Φ", 0x47: "Γ", 0x4c: "Λ", 0x50: "Π",
  0x51: "Θ", 0x53: "Σ", 0x57: "Ω", 0x2d: "−", 0x2b: "+", 0x3d: "=", 0x3c: "<", 0x3e: ">", 0xa3: "≤", 0xb3: "≥",
  0xb1: "±", 0xb4: "×", 0xb8: "÷", 0xb9: "≠", 0xbb: "≈", 0xb0: "°", 0xd6: "√", 0xa5: "∞", 0xae: "→", 0xac: "←",
  0xdb: "⇔", 0xde: "⇒", 0xb6: "∂", 0xf2: "∫", 0xe5: "∑",
};

function symbolChar(font: string, hex: string): string {
  let code = Number.parseInt(hex, 16);
  if (!Number.isFinite(code)) return "";
  if (code >= 0xf000) code -= 0xf000;
  if (/symbol/i.test(font) && SYMBOL_FONT[code]) return SYMBOL_FONT[code];
  return String.fromCharCode(code);
}

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
  const lines: string[] = [];
  const counters = new Map<string, number>();
  let lastList: string | null = null;

  for (const p of Array.from(xml.getElementsByTagNameNS(W, "p"))) {
    let text = "";
    let picture = false;
    // Every descendant, any namespace: equations (m:t) are text too, not just w:t.
    for (const node of Array.from(p.getElementsByTagName("*"))) {
      const ns = node.namespaceURI;
      if (node.localName === "t" && (ns === W || ns === M)) text += node.textContent ?? "";
      else if (ns === W && node.localName === "tab") text += " ";
      else if (ns === W && node.localName === "br") text += "\n";
      else if (ns === W && node.localName === "sym") text += symbolChar(node.getAttributeNS(W, "font") ?? "", node.getAttributeNS(W, "char") ?? "");
      else if (ns === W && (node.localName === "drawing" || node.localName === "pict")) picture = true;
    }
    if (picture) text = `${text} [picture]`;
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

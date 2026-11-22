// VORTEX Development Plan — docx builder (Bengali, DM-1 palette, Cover R1)
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, TableOfContents, PageOrientation,
} = require("docx");
const fs = require("fs");
let sizeOfMod = require("image-size");
const imgSize = (buf) => (sizeOfMod.imageSize ? sizeOfMod.imageSize(buf) : sizeOfMod(buf));

const { C1, C2, C3, C4, C5, C6, C7, C8 } = require("./vortex_content.cjs");

// ───────────────────────── Palette (DM-1 Deep Cyan — tech/AI) ─────────────────────────
const P = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
  primary: "162235", body: "000000", secondary: "666666",
};

const BODY_FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimSun", cs: "Nirmala UI" };
const HEAD_FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimHei", cs: "Nirmala UI" };

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function safeText(v, ph) {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") {
    return ph || "—";
  }
  return String(v);
}

// ───────────────────────── Cover helpers (from design-system.md) ─────────────────────────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) {
        breakAt = breakAt - 1;
      }
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    const cpl = charsPerLine(minPt);
    lines = splitTitleLines(title, cpl);
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838,
    marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight +
                        metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// Recipe R1: Pure Paragraph Cover (Left-Aligned) — design-system.md
function buildCoverR1(config) {
  const Pc = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: Pc.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: Pc.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: Pc.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: Pc.titleColor, font: { eastAsia: "SimHei", ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI" } })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800, line: 400, lineRule: "atLeast" },
      children: [new TextRun({ text: config.subtitle, size: 24, color: Pc.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI" } })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: safeText(line), size: 24, color: Pc.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI" } })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: Pc.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: Pc.footerColor, font: { ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: Pc.footerColor, font: { ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI" } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: Pc.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ───────────────────────── Body builders ─────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 200, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: HEAD_FONT })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140, line: 360, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 30, color: P.primary, font: HEAD_FONT })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after !== undefined ? opts.after : 140 },
    children: [new TextRun({ text: safeText(text), size: 24, color: P.body, font: BODY_FONT })],
  });
}

function bodyTwoRuns(leadBold, rest) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 140 },
    children: [
      new TextRun({ text: safeText(leadBold), bold: true, size: 24, color: P.body, font: BODY_FONT }),
      new TextRun({ text: safeText(rest), size: 24, color: P.body, font: BODY_FONT }),
    ],
  });
}

function bulletItem(text) {
  return new Paragraph({
    bullet: { level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 60 },
    children: [new TextRun({ text: safeText(text), size: 24, color: P.body, font: BODY_FONT })],
  });
}

function manualItem(num, text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: 420, hanging: 420 },
    spacing: { line: 312, after: 80 },
    children: [
      new TextRun({ text: num + " ", bold: true, size: 24, color: P.primary, font: BODY_FONT }),
      new TextRun({ text: safeText(text), size: 24, color: P.body, font: BODY_FONT }),
    ],
  });
}

function tableCaption(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text: safeText(text), bold: true, size: 21, color: P.primary, font: BODY_FONT })],
  });
}

function cellPara(text, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { line: 312 },
    children: [new TextRun({
      text: safeText(text), size: 21,
      bold: !!opts.bold, color: opts.color || P.body, font: BODY_FONT,
    })],
  });
}

// Horizontal-Only business table (design-system.md style 3) with DM-1 tokens
function dataTable({ headers, rows, widths }) {
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((text, i) => new TableCell({
      children: [cellPara(text, { bold: true, color: P.table.headerText, center: i === 0 && widths[0] <= 10 })],
      shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  });
  const dataRows = rows.map((cells) => new TableRow({
    cantSplit: true,
    children: cells.map((text, i) => new TableCell({
      children: [cellPara(text, { center: i === 0 && widths[0] <= 10 })],
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
}

function figureBlock(imgPath, caption, maxW = 560, maxH = 620) {
  const buf = fs.readFileSync(imgPath);
  const dims = imgSize(buf);
  const scale = Math.min(maxW / dims.width, maxH / dims.height);
  const w = Math.round(dims.width * scale);
  const h = Math.round(dims.height * scale);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160, after: 80 },
      children: [new ImageRun({ data: buf, transformation: { width: w, height: h }, type: "png" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: 312 },
      children: [new TextRun({ text: safeText(caption), size: 20, color: P.secondary, font: BODY_FONT })],
    }),
  ];
}

function spacerAfterTable() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

// ───────────────────────── Body content assembly ─────────────────────────
const DIAG = "/home/z/my-project/scripts/diagrams";
const UPLOAD = "/home/z/my-project/upload/file_0000000038408208b4af9cff06949497.png";

const bodyChildren = [];

// অধ্যায় ১
bodyChildren.push(h1(C1.title));
C1.paras.forEach((t) => bodyChildren.push(body(t)));

// অধ্যায় ২
bodyChildren.push(h1(C2.title));
bodyChildren.push(h2(C2.s21.title));
C2.s21.paras.forEach((t) => bodyChildren.push(body(t)));
bodyChildren.push(...figureBlock(UPLOAD, C2.s21.figCaption, 330, 430));
bodyChildren.push(h2(C2.s22.title));
bodyChildren.push(body(C2.s22.intro));
bodyChildren.push(tableCaption(C2.s22.tableCaption));
bodyChildren.push(dataTable({ headers: C2.s22.headers, rows: C2.s22.rows, widths: C2.s22.widths }));
bodyChildren.push(spacerAfterTable());

// অধ্যায় ৩
bodyChildren.push(h1(C3.title));
bodyChildren.push(body(C3.intro));
bodyChildren.push(tableCaption(C3.tableCaption));
bodyChildren.push(dataTable({ headers: C3.headers, rows: C3.rows, widths: C3.widths }));
bodyChildren.push(spacerAfterTable());
bodyChildren.push(body(C3.outro));

// অধ্যায় ৪
bodyChildren.push(h1(C4.title));
bodyChildren.push(h2(C4.s41.title));
bodyChildren.push(body(C4.s41.paras[0]));
bodyChildren.push(...figureBlock(DIAG + "/arch.png", C4.s41.figCaption, 560, 560));
bodyChildren.push(body(C4.s41.paras[1]));
bodyChildren.push(h2(C4.s42.title));
bodyChildren.push(body(C4.s42.intro));
bodyChildren.push(tableCaption(C4.s42.tableCaption));
bodyChildren.push(dataTable({ headers: C4.s42.headers, rows: C4.s42.rows, widths: C4.s42.widths }));
bodyChildren.push(spacerAfterTable());
bodyChildren.push(body(C4.s42.outro));
bodyChildren.push(h2(C4.s43.title));
bodyChildren.push(body(C4.s43.intro));
const bnNums = ["১.", "২.", "৩.", "৪.", "৫."];
C4.s43.items.forEach((t, i) => bodyChildren.push(manualItem(bnNums[i], t)));
bodyChildren.push(h2(C4.s44.title));
bodyChildren.push(body(C4.s44.intro));
bodyChildren.push(tableCaption(C4.s44.tableCaption));
bodyChildren.push(dataTable({ headers: C4.s44.headers, rows: C4.s44.rows, widths: C4.s44.widths }));
bodyChildren.push(spacerAfterTable());
bodyChildren.push(body(C4.s44.outro));

// অধ্যায় ৫
bodyChildren.push(h1(C5.title));
bodyChildren.push(h2(C5.s51.title));
bodyChildren.push(body(C5.s51.paras[0]));
bodyChildren.push(...figureBlock(DIAG + "/timeline.png", C5.s51.figCaption, 545, 700));
C5.phases.forEach((ph) => {
  bodyChildren.push(h2(ph.title));
  bodyChildren.push(body(ph.para));
  ph.checklist.forEach((t) => bodyChildren.push(bulletItem(t)));
  bodyChildren.push(bodyTwoRuns("শেষ হওয়ার মানদণ্ড: ", ph.criteria));
});
bodyChildren.push(h2(C5.s59.title));
bodyChildren.push(body(C5.s59.intro));
bodyChildren.push(tableCaption(C5.s59.tableCaption));
bodyChildren.push(dataTable({ headers: C5.s59.headers, rows: C5.s59.rows, widths: C5.s59.widths }));
bodyChildren.push(spacerAfterTable());

// অধ্যায় ৬
bodyChildren.push(h1(C6.title));
bodyChildren.push(h2(C6.s61.title));
C6.s61.paras.forEach((t) => bodyChildren.push(body(t)));
bodyChildren.push(h2(C6.s62.title));
bodyChildren.push(body(C6.s62.intro));
bodyChildren.push(tableCaption(C6.s62.tableCaption));
bodyChildren.push(dataTable({ headers: C6.s62.headers, rows: C6.s62.rows, widths: C6.s62.widths }));
bodyChildren.push(spacerAfterTable());
bodyChildren.push(body(C6.s62.outro));
bodyChildren.push(h2(C6.s63.title));
C6.s63.paras.forEach((t) => bodyChildren.push(body(t)));

// অধ্যায় ৭
bodyChildren.push(h1(C7.title));
bodyChildren.push(body(C7.intro));
bodyChildren.push(tableCaption(C7.tableCaption));
bodyChildren.push(dataTable({ headers: C7.headers, rows: C7.rows, widths: C7.widths }));
bodyChildren.push(spacerAfterTable());
bodyChildren.push(body(C7.outro));

// অধ্যায় ৮
bodyChildren.push(h1(C8.title));
bodyChildren.push(body(C8.paras[0]));
bodyChildren.push(body(C8.paras[1], { after: 80 }));
C8.nextSteps.forEach((t, i) => bodyChildren.push(manualItem(bnNums[i], t)));

// ───────────────────────── Footers / headers ─────────────────────────
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: BODY_FONT })],
    })],
  });
}

function bodyHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8E0EA", space: 4 } },
      children: [new TextRun({ text: "VORTEX Development Plan", size: 18, color: "808080", font: BODY_FONT })],
    })],
  });
}

// ───────────────────────── TOC section children ─────────────────────────
const tocChildren = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text: "সূচিপত্র", bold: true, size: 32, color: P.primary, font: HEAD_FONT })],
  }),
  // Hint placed before the field so it always stays on the TOC page
  // (the 26 placeholder entries fill the page; a hint after the field would spill to a near-blank page)
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new TextRun({
      text: "নোট: এই সূচিপত্রটি ফিল্ড কোড দিয়ে তৈরি। সম্পাদনার পর পাতার নম্বর হালনাগাদ করতে সূচিপত্রে রাইট-ক্লিক করে 'Update Field' নির্বাচন করুন।",
      italics: true, size: 18, color: "888888", font: BODY_FONT,
    })],
  }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
];

// ───────────────────────── Document ─────────────────────────
const pgSize = { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: BODY_FONT, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: HEAD_FONT, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 200, line: 380 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: HEAD_FONT, size: 30, bold: true, color: P.primary },
        paragraph: { spacing: { before: 280, after: 140, line: 360 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: HEAD_FONT, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 200, after: 100, line: 340 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    { // Section 1: Cover — margin 0, no footer
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "VORTEX Development Plan",
        subtitle: "নিজস্ব ইনফ্রাস্ট্রাকচারের সম্পূর্ণ উন্নয়ন পরিকল্পনা, রোডম্যাপ ও প্রযুক্তি নকশা",
        englishLabel: "VORTEX OWN INFRASTRUCTURE",
        metaLines: [
          "সংস্করণ: ১.০",
          "তারিখ: ১১ নভেম্বর ২০২৬",
          "শ্রেণিবিন্যাস: Private & Confidential",
        ],
        footerLeft: "VORTEX — Own Infrastructure",
        footerRight: "Private & Confidential",
        palette: { bg: P.bg, accent: P.accent, ...P.cover },
      }),
    },
    { // Section 2: TOC (front matter) — no page number footer
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin },
      },
      children: tocChildren,
    },
    { // Section 3: Body — Arabic page numbers from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

const OUT = "/home/z/my-project/download/VORTEX_Development_Plan_v1.0.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE " + OUT + " (" + Math.round(buf.length / 1024) + " KB)");
});

import { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable';
import logoUrl from '@/assets/hostiva-logo.png';
import coverLogoUrl from '@/assets/hostiva-cover-logo.png';
import { fmtMoney } from './money';
import type {
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
} from './statements';

/* ---------- Corporate palette (RGB tuples) ---------- */
const NAVY: [number, number, number] = [27, 42, 75];        // #1B2A4B brand navy
const NAVY_DARK: [number, number, number] = [18, 28, 51];
const GOLD: [number, number, number] = [201, 162, 86];      // #C9A256 brand gold
const GOLD_SOFT: [number, number, number] = [232, 215, 178];
const INK: [number, number, number] = [33, 37, 41];
const MUTED: [number, number, number] = [110, 117, 130];
const RED: [number, number, number] = [180, 35, 35];
const GREEN: [number, number, number] = [22, 120, 60];
const ZEBRA: [number, number, number] = [248, 246, 240];
const SECTION_BG: [number, number, number] = [240, 234, 220];
const TOTAL_BG: [number, number, number] = [233, 226, 208];
const COVER_BG: [number, number, number] = [245, 240, 228];

/* Section accent colors (RGB) — used for header bands in statements */
export const ACCENT_INCOME: [number, number, number] = [219, 234, 222];
export const ACCENT_INCOME_INK: [number, number, number] = [22, 90, 50];
export const ACCENT_EXPENSE: [number, number, number] = [232, 222, 208];
export const ACCENT_EXPENSE_INK: [number, number, number] = [102, 70, 30];
export const ACCENT_ASSET: [number, number, number] = [219, 230, 244];
export const ACCENT_ASSET_INK: [number, number, number] = [27, 60, 110];
export const ACCENT_LIAB: [number, number, number] = [240, 226, 230];
export const ACCENT_LIAB_INK: [number, number, number] = [120, 40, 60];
export const ACCENT_EQUITY: [number, number, number] = [232, 224, 244];
export const ACCENT_EQUITY_INK: [number, number, number] = [70, 45, 130];
export const ACCENT_OPERATING: [number, number, number] = [219, 234, 222];
export const ACCENT_OPERATING_INK: [number, number, number] = [22, 90, 50];
export const ACCENT_INVESTING: [number, number, number] = [219, 230, 244];
export const ACCENT_INVESTING_INK: [number, number, number] = [27, 60, 110];
export const ACCENT_FINANCING: [number, number, number] = [232, 224, 244];
export const ACCENT_FINANCING_INK: [number, number, number] = [70, 45, 130];

const PAGE_W = 595.28;   // A4 portrait points
const PAGE_H = 841.89;
const MARGIN_X = 40;

export interface SectionRow {
  label: string;
  amount: number;
  kind?: 'item' | 'subtotal' | 'total' | 'header';
  forceSign?: 'pos' | 'neg' | 'neutral';
  /** Optional accent fill for header rows (RGB tuple). */
  headerFill?: [number, number, number];
  /** Optional accent ink for header rows (RGB tuple). */
  headerInk?: [number, number, number];
}

export interface SinglePdfOptions {
  subtitle: string;
  startDate: string;
  endDate: string;
  currency: string;
  hero?: { label: string; value: number; caption?: string };
  sections: { rows: SectionRow[]; title?: string; pageBreak?: boolean }[];
  fileName: string;
}

export interface AnnualReportOptions {
  startDate: string;
  endDate: string;
  currency: string;
  pl: IncomeStatement | null;
  bs: BalanceSheet | null;
  cf: CashFlowStatement | null;
  fileName: string;
  /** Optional per-property performance rows for the new "Properties" page (page 3). */
  properties?: PropertyPerfRow[];
}

export interface PropertyPerfRow {
  title: string;
  revenue: number;
  expense: number;
  profit: number;
  margin: number; // 0..1
}

/* ---------- Helpers ---------- */

async function loadDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function drawCornerOrnament(doc: jsPDF) {
  // Soft gold curves on the upper-left and lower-right corners
  doc.setDrawColor(...GOLD_SOFT);
  doc.setLineWidth(0.6);
  for (let i = 0; i < 18; i++) {
    const o = i * 7;
    doc.line(0, 60 + o, 220 - o, 0);
  }
  for (let i = 0; i < 18; i++) {
    const o = i * 7;
    doc.line(PAGE_W, PAGE_H - 60 - o, PAGE_W - 220 + o, PAGE_H);
  }
}

function drawPageHeader(
  doc: jsPDF,
  logoData: string | null,
  label: string,
  periodSubtitle?: string,
) {
  doc.setFillColor(...NAVY_DARK);
  doc.rect(0, 0, PAGE_W, 70, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, 70, PAGE_W, 3, 'F');

  if (logoData) {
    try {
      // Header logo — aspect ratio ≈ 3.45:1. Rendered inside a white rounded
      // card that sits on the navy band (matches the brand reference).
      const logoH = 38;
      const logoW = logoH * 3.45;            // ≈131pt wide
      const padX = 12;                        // horizontal padding inside the card
      const padY = 8;                         // vertical padding inside the card
      const cardW = logoW + padX * 2;
      const cardH = logoH + padY * 2;
      const cardX = MARGIN_X;
      const cardY = (70 - cardH) / 2;

      // White rounded card behind the logo
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(cardX, cardY, cardW, cardH, 8, 8, 'F');

      doc.addImage(
        logoData,
        'PNG',
        cardX + padX,
        cardY + padY,
        logoW,
        logoH,
        undefined,
        'FAST',
      );
    } catch {/* ignore */}
  }

  doc.setTextColor(245, 232, 196);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(label.toUpperCase(), PAGE_W - MARGIN_X, 38, { align: 'right' });
  if (periodSubtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(220, 210, 180);
    doc.text(periodSubtitle, PAGE_W - MARGIN_X, 54, { align: 'right' });
  }
}

function drawFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const generated = `Generated ${new Date().toLocaleDateString()}`;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    // Skip drawing footer text on the cover (page 1) — its own bottom band already
    // shows the confidential notice and the divider would overlap with it.
    if (i === 1) continue;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(MARGIN_X, PAGE_H - 32, PAGE_W - MARGIN_X, PAGE_H - 32);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(`Confidential · Page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 18, { align: 'center' });
    doc.text(generated, PAGE_W - MARGIN_X, PAGE_H - 18, { align: 'right' });
  }
}

/* ---------- Cover page (logo only, no company name) ---------- */

function drawCoverPage(
  doc: jsPDF,
  logoData: string | null,
  title: string,
  subtitle: string,
  period: string,
) {
  // Background
  doc.setFillColor(...COVER_BG);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  drawCornerOrnament(doc);

  // Hero logo — large, centered, covering roughly the upper half of the page.
  // Aspect ratio ≈ 3:1. Width = page width minus 2*margin, capped to leave breathing room.
  if (logoData) {
    try {
      // Cover logo aspect ratio ≈ 3.04:1 (936x308).
      const logoW = Math.min(PAGE_W - MARGIN_X * 2, 460);
      const logoH = logoW / 3.04;
      // Vertically center the logo within the upper half of the page.
      const upperHalfCenterY = PAGE_H / 4; // midpoint of top half
      const logoY = upperHalfCenterY - logoH / 2;
      const logoX = (PAGE_W - logoW) / 2;
      doc.addImage(logoData, 'PNG', logoX, logoY, logoW, logoH, undefined, 'FAST');
    } catch {/* ignore */}
  }

  // Title block lives in the lower half, beneath the hero logo.
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(MARGIN_X, PAGE_H / 2 + 30, PAGE_W - MARGIN_X * 2, 230, 12, 12, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  doc.setTextColor(...NAVY);
  doc.text(title.toUpperCase(), PAGE_W / 2, PAGE_H / 2 + 100, { align: 'center' });

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(2.5);
  doc.line(PAGE_W / 2 - 60, PAGE_H / 2 + 120, PAGE_W / 2 + 60, PAGE_H / 2 + 120);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(18);
  doc.setTextColor(...GOLD);
  doc.text(subtitle, PAGE_W / 2, PAGE_H / 2 + 165, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...MUTED);
  doc.text(period, PAGE_W / 2, PAGE_H / 2 + 200, { align: 'center' });

  // Bottom footer band
  doc.setFillColor(...NAVY_DARK);
  doc.rect(0, PAGE_H - 60, PAGE_W, 60, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, PAGE_H - 63, PAGE_W, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(220, 210, 180);
  doc.text('Confidential — Prepared for internal use', PAGE_W / 2, PAGE_H - 26, { align: 'center' });
}

/* ---------- About / company page ---------- */

function drawAboutPage(doc: jsPDF, logoData: string | null) {
  doc.addPage();
  drawPageHeader(doc, logoData, 'About the company');

  let y = 110;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...NAVY);
  doc.text('Stay. Relax. Belong.', MARGIN_X, y);

  // Gold rule under tagline
  y += 10;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(2);
  doc.line(MARGIN_X, y, MARGIN_X + 70, y);
  y += 28;

  const paragraphs = [
    'We are a modern hospitality platform that connects independent property hosts with discerning travellers around the world. Our marketplace makes it simple to discover, book, and manage short-term stays — from city apartments to coastal retreats — in one secure, professionally managed environment.',
    'For hosts, we provide an end-to-end operating system: listing management, dynamic pricing, calendar synchronisation, guest messaging, payouts, and a full double-entry accounting suite. For guests, we deliver verified properties, transparent pricing, secure payments, and a curated experience built on trust and quality.',
    'This report consolidates the financial activity of your hosting business for the period shown on the cover. It is generated directly from your accounting ledger and reflects every confirmed booking, payout, refund, fee, and operating expense recorded during the period.',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  paragraphs.forEach((p) => {
    const lines = doc.splitTextToSize(p, PAGE_W - MARGIN_X * 2);
    doc.text(lines, MARGIN_X, y);
    y += lines.length * 15 + 12;
  });

  // Highlight cards (3 pillars)
  y += 8;
  const cardW = (PAGE_W - MARGIN_X * 2 - 20) / 3;
  const pillars = [
    { title: 'Trust', body: 'Verified hosts, encrypted payments and 24/7 dedicated support on every confirmed stay.' },
    { title: 'Transparency', body: 'Live double-entry books, per-property profitability, and audit-ready statements.' },
    { title: 'Performance', body: 'Tools for pricing, calendars and reviews to maximise occupancy and revenue.' },
  ];
  pillars.forEach((p, i) => {
    const x = MARGIN_X + i * (cardW + 10);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...GOLD_SOFT);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, cardW, 110, 8, 8, 'FD');
    doc.setFillColor(...GOLD);
    doc.rect(x, y, cardW, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(p.title, x + 14, y + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const bodyLines = doc.splitTextToSize(p.body, cardW - 28);
    doc.text(bodyLines, x + 14, y + 50);
  });
}

/* ---------- Financial table builder ---------- */

function buildBody(rows: SectionRow[], currency: string): RowInput[] {
  return rows.map((r) => {
    const isHeader = r.kind === 'header';
    const isSub = r.kind === 'subtotal';
    const isTotal = r.kind === 'total';

    let amountText = '';
    if (!isHeader) amountText = fmtMoney(r.amount, currency);

    // Match on-screen colors exactly: negatives -> red, positives -> green,
    // unless the row was explicitly forced to neutral (used for balance-sheet style
    // rows where signed colour would be misleading).
    let textColor: [number, number, number] = INK;
    if (!isHeader && r.forceSign !== 'neutral') {
      if (r.amount < 0) textColor = RED;
      else if (r.amount > 0) textColor = GREEN;
      else textColor = MUTED;
    }

    const headerFill = r.headerFill ?? SECTION_BG;
    const headerInk = r.headerInk ?? NAVY;

    const baseStyles: Partial<Styles> = {
      fontStyle: isHeader || isSub || isTotal ? 'bold' : 'normal',
      fillColor: isHeader
        ? headerFill
        : isTotal
          ? TOTAL_BG
          : isSub
            ? [243, 238, 224]
            : undefined,
      textColor: isHeader ? headerInk : INK,
      cellPadding: { top: isHeader ? 7 : 5, bottom: isHeader ? 7 : 5, left: 14, right: 14 },
    };

    return [
      {
        content: r.label,
        styles: {
          ...baseStyles,
          halign: 'left',
          cellPadding: {
            ...(baseStyles.cellPadding as object),
            left: isHeader || isSub || isTotal ? 14 : 26,
          },
        },
      },
      {
        content: amountText,
        styles: { ...baseStyles, halign: 'right', textColor },
      },
    ];
  });
}

function drawStatementTable(
  doc: jsPDF,
  startY: number,
  title: string,
  rows: SectionRow[],
  currency: string,
) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN_X, startY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.2);
  doc.line(MARGIN_X, startY + 4, MARGIN_X + 60, startY + 4);

  autoTable(doc, {
    startY: startY + 12,
    head: [[
      { content: 'Particulars', styles: { halign: 'left' } },
      { content: `Amount (${currency})`, styles: { halign: 'right' } },
    ]],
    body: buildBody(rows, currency),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: INK, lineColor: [225, 220, 205], lineWidth: 0.4 },
    headStyles: {
      fillColor: NAVY,
      textColor: [245, 232, 196],
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: { top: 7, bottom: 7, left: 14, right: 14 },
    },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 130, halign: 'right' } },
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 50 },
  });

  return (doc as any).lastAutoTable?.finalY ?? startY + 40;
}

/* ---------- Performance narrative ---------- */

/* ---------- Properties overview page ---------- */

function drawPropertiesPage(
  doc: jsPDF,
  logoData: string | null,
  rows: PropertyPerfRow[],
  currency: string,
  startDate: string,
  endDate: string,
) {
  doc.addPage();
  drawPageHeader(doc, logoData, 'Properties under management');

  let y = 110;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text('Property portfolio overview', MARGIN_X, y);
  y += 8;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(2);
  doc.line(MARGIN_X, y, MARGIN_X + 80, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  const intro = doc.splitTextToSize(
    `The following properties are currently active under the host account and contributed to the ` +
    `consolidated financial results presented in the statements that follow. Each row summarises ` +
    `the total revenue, operating expenses and resulting profit recognised for the reporting ` +
    `period from ${startDate} to ${endDate}.`,
    PAGE_W - MARGIN_X * 2,
  );
  doc.text(intro, MARGIN_X, y);
  y += intro.length * 14 + 10;

  if (!rows.length) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...MUTED);
    doc.text('No active properties recorded for this period.', MARGIN_X, y + 10);
    return;
  }

  // Aggregate footer totals
  const totRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totExp = rows.reduce((s, r) => s + r.expense, 0);
  const totProf = rows.reduce((s, r) => s + r.profit, 0);

  const body: RowInput[] = rows.map((r, i) => {
    const profColor: [number, number, number] = r.profit < 0 ? RED : r.profit > 0 ? GREEN : INK;
    return [
      { content: String(i + 1), styles: { halign: 'center', textColor: MUTED } },
      { content: r.title, styles: { halign: 'left', textColor: INK, fontStyle: 'bold' } },
      { content: fmtMoney(r.revenue, currency), styles: { halign: 'right', textColor: GREEN } },
      { content: fmtMoney(r.expense, currency), styles: { halign: 'right', textColor: RED } },
      { content: fmtMoney(r.profit, currency), styles: { halign: 'right', textColor: profColor, fontStyle: 'bold' } },
    ];
  });

  // Totals row
  const totProfColor: [number, number, number] = totProf < 0 ? RED : totProf > 0 ? GREEN : INK;
  body.push([
    { content: '', styles: { fillColor: TOTAL_BG } },
    { content: 'Portfolio total', styles: { halign: 'left', fontStyle: 'bold', textColor: NAVY, fillColor: TOTAL_BG } },
    { content: fmtMoney(totRev, currency), styles: { halign: 'right', textColor: GREEN, fontStyle: 'bold', fillColor: TOTAL_BG } },
    { content: fmtMoney(totExp, currency), styles: { halign: 'right', textColor: RED, fontStyle: 'bold', fillColor: TOTAL_BG } },
    { content: fmtMoney(totProf, currency), styles: { halign: 'right', textColor: totProfColor, fontStyle: 'bold', fillColor: TOTAL_BG } },
  ]);

  autoTable(doc, {
    startY: y,
    head: [[
      { content: '#', styles: { halign: 'center' } },
      { content: 'Property', styles: { halign: 'left' } },
      { content: `Revenue (${currency})`, styles: { halign: 'right' } },
      { content: `Expenses (${currency})`, styles: { halign: 'right' } },
      { content: `Profit (${currency})`, styles: { halign: 'right' } },
    ]],
    body,
    theme: 'plain',
    // Slightly smaller body font + tabular-friendly padding so amount digits fit on one line.
    // Default overflow stays 'linebreak' so long property names wrap onto multiple lines.
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: INK,
      lineColor: [225, 220, 205],
      lineWidth: 0.4,
      cellPadding: { top: 7, bottom: 7, left: 8, right: 8 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: NAVY,
      textColor: [245, 232, 196],
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
      overflow: 'visible',
    },
    alternateRowStyles: { fillColor: ZEBRA },
    // Total content width on A4 with 40pt margins ≈ 515pt. Distribute so each
    // amount column is wide enough to keep the largest formatted KES value on
    // a single line, leaving the property name to consume the remainder.
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left', overflow: 'linebreak' },
      2: { cellWidth: 105, halign: 'right', overflow: 'visible' },
      3: { cellWidth: 105, halign: 'right', overflow: 'visible' },
      4: { cellWidth: 105, halign: 'right', overflow: 'visible' },
    },
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: 50 },
  });

  // Brief analysis under the table
  let yAfter = (doc as any).lastAutoTable?.finalY ?? y + 100;
  yAfter += 18;
  if (yAfter > PAGE_H - 130) return; // leave room or skip

  const top = [...rows].sort((a, b) => b.profit - a.profit)[0];
  const bottom = [...rows].sort((a, b) => a.profit - b.profit)[0];
  const lines: string[] = [];
  lines.push(
    `Across ${rows.length} active ${rows.length === 1 ? 'property' : 'properties'}, the portfolio ` +
    `generated total revenue of ${fmtMoney(totRev, currency)} against operating expenses of ` +
    `${fmtMoney(totExp, currency)}, producing a consolidated profit of ${fmtMoney(totProf, currency)} ` +
    `for the reporting period.`,
  );
  if (top && rows.length > 1) {
    lines.push(
      `The strongest contributor was "${top.title}" with a profit of ${fmtMoney(top.profit, currency)}, ` +
      `while "${bottom.title}" delivered ${fmtMoney(bottom.profit, currency)} and may warrant a ` +
      `pricing, occupancy or cost review. The detailed financial statements that follow consolidate ` +
      `these property-level results into the official income statement, balance sheet and cash flow.`,
    );
  } else {
    lines.push(
      'The detailed financial statements that follow consolidate these property-level results ' +
      'into the official income statement, balance sheet and cash flow.',
    );
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text('Performance commentary', MARGIN_X, yAfter);
  yAfter += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  lines.forEach((p) => {
    const wrapped = doc.splitTextToSize(p, PAGE_W - MARGIN_X * 2);
    if (yAfter + wrapped.length * 13 > PAGE_H - 60) return;
    doc.text(wrapped, MARGIN_X, yAfter);
    yAfter += wrapped.length * 13 + 8;
  });
}

function buildNarrative(
  pl: IncomeStatement | null,
  bs: BalanceSheet | null,
  cf: CashFlowStatement | null,
  currency: string,
): string[] {
  const out: string[] = [];
  if (pl) {
    const rev = pl.totalRevenue.toNumber();
    const exp = pl.totalExpenses.toNumber();
    const net = pl.netIncome.toNumber();
    const margin = rev !== 0 ? (net / rev) * 100 : 0;
    const stance = net > 0 ? 'profitable' : net < 0 ? 'loss-making' : 'break-even';
    out.push(
      `Over the reporting period the business recorded total revenue of ${fmtMoney(rev, currency)} ` +
      `against total operating expenses of ${fmtMoney(exp, currency)}, producing a net result of ` +
      `${fmtMoney(net, currency)} — a ${stance} position with a ${margin.toFixed(1)}% net margin.`
    );
    if (net > 0) {
      out.push(
        `The positive bottom line indicates that revenue from bookings, fees and ancillary services is ` +
        `comfortably covering operating costs. Maintaining this margin will depend on protecting occupancy, ` +
        `keeping refund and cancellation costs under control, and ensuring that variable expenses scale slower than top-line growth.`
      );
    } else if (net < 0) {
      out.push(
        `The negative bottom line signals that expenses, refunds or cancellation losses are currently ` +
        `outpacing income. The largest expense lines on the income statement should be reviewed for ` +
        `optimisation opportunities, and pricing or occupancy strategy may need to be adjusted to restore profitability.`
      );
    }
  }
  if (bs) {
    const a = bs.totalAssets.toNumber();
    const l = bs.totalLiabilities.toNumber();
    const e = bs.totalEquity.toNumber();
    out.push(
      `On the balance sheet, total assets stand at ${fmtMoney(a, currency)}, financed by ` +
      `${fmtMoney(l, currency)} of liabilities and ${fmtMoney(e, currency)} of equity. ` +
      `The books are ${bs.isBalanced ? 'in balance' : 'currently out of balance and require review'}, ` +
      `which is the foundation of reliable financial reporting.`
    );
  }
  if (cf) {
    const op = cf.operatingCash.toNumber();
    const nc = cf.netChange.toNumber();
    out.push(
      `Cash from operating activities for the period was ${fmtMoney(op, currency)}, with a net change in ` +
      `cash of ${fmtMoney(nc, currency)}. ${op >= 0
        ? 'Operations are self-funding, which strengthens working capital and reduces reliance on external financing.'
        : 'Operations consumed cash during the period, so cash reserves and payout timing should be monitored closely.'}`
    );
  }
  out.push(
    'This narrative is generated automatically from your live accounting ledger. For a deeper review, ' +
    'drill into the per-property profit report and recognition vs. bookings report inside the dashboard.'
  );
  return out;
}

/* ---------- Public API: single statement PDF ---------- */

export async function exportFinancialPdf(opts: SinglePdfOptions) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let logoData: string | null = null;
  let coverLogoData: string | null = null;
  try { logoData = await loadDataUrl(logoUrl); } catch {/* ignore */}
  try { coverLogoData = await loadDataUrl(coverLogoUrl); } catch {/* ignore */}

  // Cover
  drawCoverPage(
    doc,
    coverLogoData,
    'Financial Report',
    opts.subtitle,
    `${opts.startDate} — ${opts.endDate}`,
  );

  // Statement page
  doc.addPage();
  drawPageHeader(doc, logoData, opts.subtitle, `${opts.startDate} — ${opts.endDate}`);
  let y = 100;

  if (opts.hero) {
    const isNeg = opts.hero.value < 0;
    doc.setFillColor(...COVER_BG);
    doc.roundedRect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, 80, 8, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.text(opts.hero.label.toUpperCase(), MARGIN_X + 16, y + 22);
    doc.setFontSize(26);
    doc.setTextColor(...(isNeg ? RED : GREEN));
    doc.text(fmtMoney(opts.hero.value, opts.currency), MARGIN_X + 16, y + 54);
    if (opts.hero.caption) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text(opts.hero.caption, MARGIN_X + 16, y + 70);
    }
    y += 100;
  }

  opts.sections.forEach((s, i) => {
    if (i > 0) {
      if (s.pageBreak) {
        doc.addPage();
        drawPageHeader(doc, logoData, s.title ?? opts.subtitle, `${opts.startDate} — ${opts.endDate}`);
        y = 100;
      } else {
        y += 16;
      }
    }
    y = drawStatementTable(doc, y, s.title ?? opts.subtitle, s.rows, opts.currency) + 10;
  });

  drawFooter(doc);
  doc.save(opts.fileName);
}

/* ---------- Public API: combined Annual Report PDF ---------- */

export async function exportAnnualReportPdf(opts: AnnualReportOptions) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let logoData: string | null = null;
  let coverLogoData: string | null = null;
  try { logoData = await loadDataUrl(logoUrl); } catch {/* ignore */}
  try { coverLogoData = await loadDataUrl(coverLogoUrl); } catch {/* ignore */}

  // Page 1 — Cover (logo only, no company name)
  drawCoverPage(
    doc,
    coverLogoData,
    'Annual Report',
    'Consolidated Financial Statements',
    `${opts.startDate} — ${opts.endDate}`,
  );

  // Page 2 — About the company narration
  drawAboutPage(doc, logoData);

  // Page 3 — Properties under management (portfolio overview)
  drawPropertiesPage(
    doc,
    logoData,
    opts.properties ?? [],
    opts.currency,
    opts.startDate,
    opts.endDate,
  );

  // Page 4+ — Income Statement
  if (opts.pl) {
    doc.addPage();
    drawPageHeader(
      doc,
      logoData,
      'Income Statement (P&L)',
      `For the period ${opts.startDate} to ${opts.endDate}`,
    );
    let y = 100;

    // Hero KPI
    const rev = opts.pl.totalRevenue.toNumber();
    const net = opts.pl.netIncome.toNumber();
    const margin = rev !== 0 ? (net / rev) * 100 : 0;
    const isNeg = net < 0;
    doc.setFillColor(...COVER_BG);
    doc.roundedRect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, 80, 8, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.text('NET INCOME', MARGIN_X + 16, y + 22);
    doc.setFontSize(26);
    doc.setTextColor(...(isNeg ? RED : GREEN));
    doc.text(fmtMoney(net, opts.currency), MARGIN_X + 16, y + 54);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(`${margin.toFixed(1)}% margin · period ${opts.startDate} to ${opts.endDate}`, MARGIN_X + 16, y + 70);
    y += 100;

    const plRows: SectionRow[] = [
      { label: 'INCOME', amount: 0, kind: 'header', headerFill: ACCENT_INCOME, headerInk: ACCENT_INCOME_INK },
      ...opts.pl.revenueRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
      { label: 'Gross income', amount: opts.pl.totalRevenue.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'EXPENSES', amount: 0, kind: 'header', headerFill: ACCENT_EXPENSE, headerInk: ACCENT_EXPENSE_INK },
      ...opts.pl.expenseRows.map((r) => ({ label: r.name, amount: Math.abs(r.balance.toNumber()), kind: 'item' as const, forceSign: 'neutral' as const })),
      { label: 'Total expenses', amount: Math.abs(opts.pl.totalExpenses.toNumber()), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'NET INCOME', amount: opts.pl.netIncome.toNumber(), kind: 'total', forceSign: 'neutral' as const },
    ];
    drawStatementTable(doc, y, 'Income Statement', plRows, opts.currency);
  }

  // Balance Sheet
  if (opts.bs) {
    doc.addPage();
    drawPageHeader(doc, logoData, 'Balance Sheet', `As of ${opts.endDate}`);

    // Single unified frame — Assets, Liabilities and Equity together (matches on-screen layout)
    const bsRows: SectionRow[] = [
      { label: 'ASSETS', amount: 0, kind: 'header', headerFill: ACCENT_ASSET, headerInk: ACCENT_ASSET_INK },
      ...opts.bs.assetRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
      { label: 'Total assets', amount: opts.bs.totalAssets.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'LIABILITIES', amount: 0, kind: 'header', headerFill: ACCENT_LIAB, headerInk: ACCENT_LIAB_INK },
      ...opts.bs.liabilityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
      { label: 'Total liabilities', amount: opts.bs.totalLiabilities.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'EQUITY', amount: 0, kind: 'header', headerFill: ACCENT_EQUITY, headerInk: ACCENT_EQUITY_INK },
      ...opts.bs.equityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
      { label: 'Current year earnings', amount: opts.bs.currentEarnings.toNumber(), kind: 'item', forceSign: 'neutral' as const },
      { label: 'Total equity', amount: opts.bs.totalEquity.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'Total liabilities + equity', amount: opts.bs.totalLiabilities.plus(opts.bs.totalEquity).toNumber(), kind: 'total', forceSign: 'neutral' as const },
    ];
    drawStatementTable(doc, 100, `Balance Sheet — as of ${opts.endDate}`, bsRows, opts.currency);
  }

  // Cash Flow
  if (opts.cf) {
    doc.addPage();
    drawPageHeader(
      doc,
      logoData,
      'Cash Flow Statement',
      'For the Year Ended December 31, 2025',
    );
    let y = 100;
    const ncIsNeg = opts.cf.netChange.toNumber() < 0;
    doc.setFillColor(...COVER_BG);
    doc.roundedRect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, 80, 8, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.text('NET CHANGE IN CASH', MARGIN_X + 16, y + 22);
    doc.setFontSize(26);
    doc.setTextColor(...(ncIsNeg ? RED : GREEN));
    doc.text(fmtMoney(opts.cf.netChange, opts.currency), MARGIN_X + 16, y + 54);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('Indirect method', MARGIN_X + 16, y + 70);
    y += 100;

    const rows: SectionRow[] = [
      { label: 'OPERATING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_OPERATING, headerInk: ACCENT_OPERATING_INK },
      { label: 'Net income', amount: opts.cf.netIncome.toNumber(), kind: 'item', forceSign: 'neutral' as const },
      { label: 'Add back: depreciation', amount: opts.cf.depreciation.toNumber(), kind: 'item', forceSign: 'neutral' as const },
      { label: 'Cash from operations', amount: opts.cf.operatingCash.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'INVESTING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_INVESTING, headerInk: ACCENT_INVESTING_INK },
      { label: 'Net cash from investing', amount: opts.cf.investingCash.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'FINANCING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_FINANCING, headerInk: ACCENT_FINANCING_INK },
      { label: 'Net cash from financing', amount: opts.cf.financingCash.toNumber(), kind: 'subtotal', forceSign: 'neutral' as const },
      { label: 'NET CHANGE IN CASH', amount: opts.cf.netChange.toNumber(), kind: 'total', forceSign: 'neutral' as const },
    ];
    drawStatementTable(doc, y, 'Cash Flow Statement', rows, opts.currency);
  }

  // Performance analysis page
  doc.addPage();
  drawPageHeader(doc, logoData, 'Performance Analysis');
  let y = 110;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text('How the business is performing', MARGIN_X, y);
  y += 8;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(2);
  doc.line(MARGIN_X, y, MARGIN_X + 80, y);
  y += 26;

  // Three KPI tiles
  const kpiW = (PAGE_W - MARGIN_X * 2 - 20) / 3;
  const kpis = [
    { label: 'Revenue', value: opts.pl ? fmtMoney(opts.pl.totalRevenue, opts.currency) : '—' },
    { label: 'Net income', value: opts.pl ? fmtMoney(opts.pl.netIncome, opts.currency) : '—', isNeg: opts.pl ? opts.pl.netIncome.toNumber() < 0 : false },
    { label: 'Cash change', value: opts.cf ? fmtMoney(opts.cf.netChange, opts.currency) : '—', isNeg: opts.cf ? opts.cf.netChange.toNumber() < 0 : false },
  ];
  kpis.forEach((k, i) => {
    const x = MARGIN_X + i * (kpiW + 10);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...GOLD_SOFT);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, kpiW, 86, 8, 8, 'FD');
    doc.setFillColor(...GOLD);
    doc.rect(x, y, kpiW, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(k.label.toUpperCase(), x + 14, y + 28);
    doc.setFontSize(18);
    doc.setTextColor(...((k as any).isNeg ? RED : NAVY));
    doc.text(k.value, x + 14, y + 60);
  });
  y += 110;

  // Narrative
  const narrative = buildNarrative(opts.pl, opts.bs, opts.cf, opts.currency);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  narrative.forEach((p) => {
    if (y > PAGE_H - 100) {
      doc.addPage();
      drawPageHeader(doc, logoData, 'Performance Analysis');
      y = 110;
    }
    const lines = doc.splitTextToSize(p, PAGE_W - MARGIN_X * 2);
    doc.text(lines, MARGIN_X, y);
    y += lines.length * 15 + 12;
  });

  drawFooter(doc);
  doc.save(opts.fileName);
}
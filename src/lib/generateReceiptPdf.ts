import jsPDF from 'jspdf';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import hostivaLogoUrl from '@/assets/hostiva-logo.png';

export interface ReceiptData {
  bookingCode: string;
  bookingCreatedAt: string | Date;
  status: string;
  currency: string;

  property: {
    title: string;
    propertyType: string;
    address: string;
    city: string;
    state?: string | null;
    country: string;
    postalCode?: string | null;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    maxGuests: number;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  };

  trip: {
    checkIn: string | Date;
    checkOut: string | Date;
    numNights: number;
    numGuests: number;
  };

  pricing: {
    nightlyRate: number;
    subtotal: number;
    cleaningFee: number;
    serviceFee: number;
    total: number;
  };

  guestName?: string | null;
  guestEmail?: string | null;
  /** Optional pre-generated QR code as a data URL (PNG). Use generateBookingQr(). */
  qrDataUrl?: string | null;
  /** Optional booking detail URL — used to render a small caption under the QR. */
  bookingUrl?: string | null;
}

/**
 * Generate a QR code data URL pointing to the booking detail page.
 * Call this before generateReceiptPdf and pass the result via `qrDataUrl`.
 */
export async function generateBookingQr(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 0,
    width: 240,
    color: { dark: '#111827', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Build a self-contained QR payload that includes the booking URL plus the
 * key booking facts (code, property, dates, guest, total). Even on a slow or
 * offline connection, scanning surfaces the essentials immediately — the URL
 * line lets compatible scanners still open the live booking page.
 *
 * Format is human-readable plain text so any QR scanner app shows it cleanly.
 */
export function buildBookingQrPayload(data: ReceiptData, bookingUrl: string): string {
  const cur = data.currency.toUpperCase();
  const total = `${cur} ${data.pricing.total.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const checkIn = format(new Date(data.trip.checkIn), 'EEE, MMM d, yyyy');
  const checkOut = format(new Date(data.trip.checkOut), 'EEE, MMM d, yyyy');
  const lines = [
    'HOSTIVA BOOKING',
    `Code: ${data.bookingCode}`,
    `Property: ${data.property.title}`,
    `Location: ${[data.property.city, data.property.country].filter(Boolean).join(', ')}`,
    `Check-in: ${checkIn}`,
    `Check-out: ${checkOut}`,
    `Nights: ${data.trip.numNights} · Guests: ${data.trip.numGuests}`,
    data.guestName ? `Guest: ${data.guestName}` : null,
    `Total: ${total}`,
    `Status: ${data.status.toUpperCase()}`,
    `View: ${bookingUrl}`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Generate a QR carrying the embedded booking summary AND the URL — preferred
 * over the bare URL form. Uses higher error correction so the denser payload
 * still scans reliably from a printed page.
 */
export async function generateRichBookingQr(
  data: ReceiptData,
  bookingUrl: string
): Promise<string> {
  const payload = buildBookingQrPayload(data, bookingUrl);
  return QRCode.toDataURL(payload, {
    margin: 0,
    width: 320,
    color: { dark: '#1F3F7A', light: '#ffffff' }, // navy on white — matches brand
    errorCorrectionLevel: 'Q', // tolerates the larger payload + smudges/print
  });
}

const BRAND = {
  name: 'Hostiva',
  tagline: 'Stay. Relax. Belong.',
  // Logo navy + gold — used as the receipt's primary brand colours so the
  // PDF matches the on-screen Hostiva mark exactly.
  primary: [31, 63, 122] as [number, number, number],   // #1F3F7A navy
  accent: [212, 162, 76] as [number, number, number],   // #D4A24C gold
  ink: [17, 24, 39] as [number, number, number],
  muted: [107, 114, 128] as [number, number, number],
  line: [229, 231, 235] as [number, number, number],
  soft: [249, 250, 251] as [number, number, number],
};

const fmtMoney = (n: number, cur: string) =>
  `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtTime = (t?: string | null) => {
  if (!t) return null;
  try {
    return format(new Date(`2000-01-01T${t}`), 'h:mm a');
  } catch {
    return t;
  }
};

/**
 * Load the Hostiva brand logo as a base64 data URL. Cached after the first
 * call so subsequent receipts reuse the same buffer without another fetch.
 */
let _logoDataUrlPromise: Promise<string | null> | null = null;
async function loadBrandLogo(): Promise<string | null> {
  if (!_logoDataUrlPromise) {
    _logoDataUrlPromise = (async () => {
      try {
        const res = await fetch(hostivaLogoUrl);
        if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`);
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
    // If the load resolves to null (failure), don't cache it — let the next
    // receipt try again so a transient network blip doesn't permanently
    // downgrade every receipt for the session to the wordmark fallback.
    _logoDataUrlPromise.then((v) => {
      if (v === null) _logoDataUrlPromise = null;
    });
  }
  return _logoDataUrlPromise;
}

export interface GenerateReceiptOptions {
  /** When true, overlay a large diagonal "PREVIEW" watermark on every page. Use for in-app preview only. */
  preview?: boolean;
  /**
   * When true, overlay debug guides on the PDF — currently outlines the QR/scan reserved area
   * and the safe zone below it where PROPERTY DETAILS may begin. Use only for layout debugging.
   */
  debug?: boolean;
}

export async function generateReceiptPdf(
  data: ReceiptData,
  options: GenerateReceiptOptions = {}
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const logoDataUrl = await loadBrandLogo();
  // Helper exposed in closure so we can use it in the price breakdown section
  const isConfirmedBooking =
    data.status.toLowerCase() === 'confirmed' ||
    data.status.toLowerCase() === 'completed';
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 0;

  // ===== HEADER BAR =====
  const headerH = 110;
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, pageW, headerH, 'F');

  // Gold accent stripe at bottom of header — matches the gold roof in the logo.
  doc.setFillColor(...BRAND.accent);
  doc.rect(0, headerH - 4, pageW, 4, 'F');

  // ----- Hostiva logo (left aligned) — replaces the typed brand name. -----
  // Logo is wider than tall (≈3:1), so we size by height and let width follow.
  const logoH = 64;
  const logoW = logoH * 3.04; // matches the source asset 936×308 ratio
  const logoY = (headerH - logoH) / 2;
  // Shared brand-coloured wordmark fallback. Used when the logo asset can't be
  // fetched (offline, blocked, decode error). Keeps the SAME white rounded
  // plate and brand colours so downloaded receipts stay visually consistent
  // with the in-app preview — never a bare white-on-navy text label.
  const drawWordmarkFallback = () => {
    // Same plate geometry as the image path, so the header layout is identical.
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin - 6, logoY - 6, logoW + 12, logoH + 12, 6, 6, 'F');
    // Gold accent square (mirrors the gold "roof" in the real logo).
    const dotSize = 14;
    const dotX = margin + 4;
    const dotY = logoY + (logoH - dotSize) / 2;
    doc.setFillColor(...BRAND.accent);
    doc.roundedRect(dotX, dotY, dotSize, dotSize, 2, 2, 'F');
    // Navy wordmark, vertically centred inside the plate.
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.primary);
    doc.setFontSize(34);
    // @ts-ignore — setCharSpace is available on jsPDF runtime
    if (typeof (doc as any).setCharSpace === 'function') (doc as any).setCharSpace(1.2);
    doc.text(BRAND.name.toUpperCase(), dotX + dotSize + 8, logoY + logoH / 2 + 11);
    // @ts-ignore
    if (typeof (doc as any).setCharSpace === 'function') (doc as any).setCharSpace(0);
  };

  let logoRendered = false;
  if (logoDataUrl) {
    try {
      // White rounded plate so the navy + gold logo stays crisp on the navy header.
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin - 6, logoY - 6, logoW + 12, logoH + 12, 6, 6, 'F');
      doc.addImage(logoDataUrl, 'PNG', margin, logoY, logoW, logoH);
      logoRendered = true;
    } catch {
      logoRendered = false;
    }
  }
  if (!logoRendered) {
    drawWordmarkFallback();
  }

  const brandY = headerH / 2 - 4;

  // ----- RECEIPT label (right) -----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text('BOOKING RECEIPT', pageW - margin, brandY, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(220, 230, 245);
  doc.text(
    `Issued ${format(new Date(), 'MMM d, yyyy · h:mm a')}`,
    pageW - margin,
    brandY + 16,
    { align: 'right' }
  );

  y = headerH + 28;

  // ===== BOOKING META BOX (3-column layout — generous spacing, no overlap) =====
  const metaH = 132;
  doc.setDrawColor(...BRAND.line);
  doc.setFillColor(...BRAND.soft);
  doc.roundedRect(margin, y, pageW - margin * 2, metaH, 8, 8, 'FD');

  const innerPadX = 22;
  const colCount = 3;
  const gutter = 18;
  const colW = (pageW - margin * 2 - innerPadX * 2 - gutter * (colCount - 1)) / colCount;
  const col1X = margin + innerPadX;
  const col2X = col1X + colW + gutter;
  const col3RightX = pageW - margin - innerPadX; // right-aligned column anchor

  // Vertical rhythm — generous gaps so labels and values never overlap
  const rowTopY = y + 22;
  const rowTopValueY = rowTopY + 16;
  const rowBottomY = rowTopY + 50;
  const rowBottomValueY = rowBottomY + 16;

  const drawMetaLabel = (text: string, x: number, ypos: number, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(text, x, ypos, { align });
  };

  // QR code (optional) — smaller (56pt) and anchored to the BOTTOM-RIGHT of column 1.
  // The booking code on the top row spans the FULL column width above the QR (no shrinking).
  // Only the guest name (bottom row) shares its row width with the QR.
  const qrSize = 56;
  // Hide QR entirely in preview mode — guests should only see it on the official downloaded copy.
  const hasQr = Boolean(data.qrDataUrl) && !options.preview;
  const guestRowTextW = hasQr ? colW - qrSize - 10 : colW;

  // Reserve the QR rectangle up-front so PROPERTY DETAILS can never overlap it,
  // regardless of whether the image draw succeeds. These coordinates are also
  // used by the debug overlay below.
  const qrRectX = col1X + colW - qrSize - 3;
  const qrRectY = rowBottomY - 6 - 3;
  const qrRectW = qrSize + 6;
  const qrRectH = qrSize + 6 + 10; // include "Scan to view" caption

  // Column 1, row 1: Booking code — uses FULL column width so the complete code is always visible above the QR
  drawMetaLabel('BOOKING CODE', col1X, rowTopY);
  doc.setFont('courier', 'bold');
  doc.setTextColor(...BRAND.primary);
  let codeFontSize = 14;
  doc.setFontSize(codeFontSize);
  while (doc.getTextWidth(data.bookingCode) > colW && codeFontSize > 9) {
    codeFontSize -= 0.5;
    doc.setFontSize(codeFontSize);
  }
  doc.text(data.bookingCode, col1X, rowTopValueY);

  // Column 1, row 2: Guest (shares the row with the QR — auto-shrink to fit reduced width)
  if (data.guestName) {
    drawMetaLabel('GUEST', col1X, rowBottomY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.ink);
    let guestFontSize = 11;
    doc.setFontSize(guestFontSize);
    while (doc.getTextWidth(data.guestName) > guestRowTextW && guestFontSize > 7.5) {
      guestFontSize -= 0.5;
      doc.setFontSize(guestFontSize);
    }
    doc.text(data.guestName, col1X, rowBottomValueY);
  }

  // QR code rendering — anchored to bottom-right of column 1 (BELOW the booking code, beside the guest)
  if (hasQr && data.qrDataUrl) {
    const qrX = col1X + colW - qrSize;
    const qrY = rowBottomY - 6; // sits aligned with the guest row, well below booking code
    try {
      // Subtle white card behind QR
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...BRAND.line);
      doc.roundedRect(qrX - 3, qrY - 3, qrSize + 6, qrSize + 6, 3, 3, 'FD');
      doc.addImage(data.qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...BRAND.muted);
      doc.text('Scan for booking details', qrX + qrSize / 2, qrY + qrSize + 8, { align: 'center' });
    } catch (e) {
      // If image fails to embed, just skip QR silently
    }
  }

  // Column 2, row 1: Booked on (date + time on one line, compact)
  drawMetaLabel('BOOKED ON', col2X, rowTopY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND.ink);
  doc.text(
    `${format(new Date(data.bookingCreatedAt), 'MMM d, yyyy')}  ${format(new Date(data.bookingCreatedAt), 'h:mm a')}`,
    col2X,
    rowTopValueY
  );

  // Column 2, row 2: Issued on
  drawMetaLabel('ISSUED ON', col2X, rowBottomY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND.ink);
  doc.text(format(new Date(), 'MMM d, yyyy'), col2X, rowBottomValueY);

  // Column 3, row 1: Status badge (right aligned)
  // Place badge BELOW the "STATUS" label, vertically centered in the value slot — no overlap with label or other rows
  drawMetaLabel('STATUS', col3RightX, rowTopY, 'right');
  const statusText = data.status.toUpperCase();
  const isConfirmed =
    data.status.toLowerCase() === 'confirmed' ||
    data.status.toLowerCase() === 'completed';
  const badgeColor: [number, number, number] = isConfirmed ? [22, 163, 74] : [217, 119, 6];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const badgeH = 18;
  const badgeW = doc.getTextWidth(statusText) + 22;
  const badgeX = col3RightX - badgeW;
  // Sit the badge centered on the value baseline row, well clear of the label above
  const badgeY = rowTopValueY - badgeH + 4;
  doc.setFillColor(...badgeColor);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2, badgeH / 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(statusText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 3.2, { align: 'center' });

  // Column 3, row 2: Total paid (right aligned)
  drawMetaLabel('TOTAL PAID', col3RightX, rowBottomY, 'right');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.primary);
  doc.text(
    fmtMoney(data.pricing.total, data.currency.toUpperCase()),
    col3RightX,
    rowBottomValueY,
    { align: 'right' }
  );

  // Tighter gap between meta box (with QR) and PROPERTY DETAILS heading.
  // If the QR is rendered, ensure y is *at least* below the QR card + caption +
  // a safety pad, so PROPERTY DETAILS can never overlap it on any page size.
  const metaBottomY = y + metaH + 22;
  const qrSafeBottomY = hasQr ? qrRectY + qrRectH + 16 : 0;
  y = Math.max(metaBottomY, qrSafeBottomY);

  // ----- DEBUG OVERLAY (opt-in via options.debug) -----
  // Outlines the reserved QR area and the safe zone where PROPERTY DETAILS may begin.
  if (options.debug && hasQr) {
    doc.saveGraphicsState();
    // QR reserved rect — magenta dashed
    doc.setDrawColor(236, 72, 153);
    doc.setLineWidth(0.8);
    // @ts-ignore — setLineDash exists on jsPDF runtime
    if (typeof (doc as any).setLineDash === 'function') (doc as any).setLineDash([4, 3], 0);
    doc.rect(qrRectX, qrRectY, qrRectW, qrRectH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(236, 72, 153);
    doc.text('QR RESERVED', qrRectX + 2, qrRectY - 3);
    // Safe-zone separator across the page at the QR bottom + pad
    doc.setDrawColor(34, 197, 94);
    doc.line(margin, qrSafeBottomY, pageW - margin, qrSafeBottomY);
    doc.text('PROPERTY DETAILS SAFE ZONE ↓', margin, qrSafeBottomY - 3);
    // @ts-ignore
    if (typeof (doc as any).setLineDash === 'function') (doc as any).setLineDash([], 0);
    doc.restoreGraphicsState();
  }

  // ===== SECTION: PROPERTY =====
  drawSectionHeader(doc, 'PROPERTY DETAILS', margin, y, pageW);
  y += 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.ink);
  const titleLines = doc.splitTextToSize(data.property.title, pageW - margin * 2);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...BRAND.muted);
  const addrParts = [
    data.property.address,
    [data.property.city, data.property.state, data.property.postalCode].filter(Boolean).join(', '),
    data.property.country,
  ].filter(Boolean);
  addrParts.forEach((line) => {
    doc.text(line, margin, y);
    y += 13;
  });

  y += 8;

  // Property facts row
  const facts = [
    ['Type', cap(data.property.propertyType)],
    ['Bedrooms', String(data.property.bedrooms)],
    ['Beds', String(data.property.beds)],
    ['Bathrooms', String(data.property.bathrooms)],
    ['Max guests', String(data.property.maxGuests)],
  ];
  const factW = (pageW - margin * 2) / facts.length;
  facts.forEach(([label, val], i) => {
    const x = margin + i * factW;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(val, x, y + 13);
  });
  y += 34;

  // ===== SECTION: TRIP DETAILS =====
  drawSectionHeader(doc, 'TRIP DETAILS', margin, y, pageW);
  y += 18;

  const checkInTime = fmtTime(data.property.checkInTime);
  const checkOutTime = fmtTime(data.property.checkOutTime);

  const tripCols = [
    {
      label: 'CHECK-IN',
      value: format(new Date(data.trip.checkIn), 'EEE, MMM d, yyyy'),
      sub: checkInTime ? `After ${checkInTime}` : null,
    },
    {
      label: 'CHECK-OUT',
      value: format(new Date(data.trip.checkOut), 'EEE, MMM d, yyyy'),
      sub: checkOutTime ? `Before ${checkOutTime}` : null,
    },
    {
      label: 'DURATION',
      value: `${data.trip.numNights} ${data.trip.numNights === 1 ? 'night' : 'nights'}`,
      sub: null,
    },
    {
      label: 'GUESTS',
      value: `${data.trip.numGuests} ${data.trip.numGuests === 1 ? 'guest' : 'guests'}`,
      sub: null,
    },
  ];
  const tripColW = (pageW - margin * 2) / tripCols.length;
  tripCols.forEach((c, i) => {
    const x = margin + i * tripColW;
    doc.setDrawColor(...BRAND.line);
    doc.setFillColor(...BRAND.soft);
    doc.roundedRect(x + 4, y, tripColW - 8, 60, 4, 4, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(c.label, x + 14, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(c.value, x + 14, y + 34);
    if (c.sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...BRAND.muted);
      doc.text(c.sub, x + 14, y + 48);
    }
  });
  y += 60 + 22;

  // ===== SECTION: PRICE BREAKDOWN =====
  drawSectionHeader(doc, 'PRICE BREAKDOWN', margin, y, pageW);
  y += 18;

  const cur = data.currency.toUpperCase();
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    {
      label: `${fmtMoney(data.pricing.nightlyRate, cur)} × ${data.trip.numNights} ${data.trip.numNights === 1 ? 'night' : 'nights'}`,
      value: fmtMoney(data.pricing.subtotal, cur),
    },
  ];
  if (data.pricing.cleaningFee > 0) {
    rows.push({ label: 'Cleaning fee', value: fmtMoney(data.pricing.cleaningFee, cur) });
  }
  if (data.pricing.serviceFee > 0) {
    rows.push({ label: 'Service fee', value: fmtMoney(data.pricing.serviceFee, cur) });
  }

  rows.forEach((r) => {
    // Consistent weight rhythm: labels are medium-weight ink, values are bold pure-black
    // so prices read with stronger contrast against the page.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(r.label, margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(r.value, pageW - margin, y, { align: 'right' });
    y += 18;
  });

  // Divider
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.7);
  doc.line(margin, y - 6, pageW - margin, y - 6);
  y += 8;

  // Total row
  doc.setFillColor(...BRAND.soft);
  doc.roundedRect(margin, y - 4, pageW - margin * 2, 38, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.ink);
  doc.text('Total paid', margin + 14, y + 20);
  doc.setTextColor(...BRAND.primary);
  doc.setFontSize(16);
  doc.text(fmtMoney(data.pricing.total, cur), pageW - margin - 14, y + 20, { align: 'right' });
  y += 50;

  // Payment confirmation note
  if (isConfirmed) {
    doc.setFillColor(220, 252, 231);
    doc.setDrawColor(134, 239, 172);
    doc.roundedRect(margin, y, pageW - margin * 2, 28, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(21, 128, 61);
    doc.text(
      `PAYMENT RECEIVED  ·  ${fmtMoney(data.pricing.total, cur)}  ·  Reference ${data.bookingCode}`,
      pageW / 2,
      y + 18,
      { align: 'center' }
    );
    y += 40;
  }

  // ===== FOOTER =====
  const pageH = doc.internal.pageSize.getHeight();
  const footerY = pageH - 76;

  // Thank you note
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND.primary);
  doc.text(`Thank you for booking with ${BRAND.name}.`, pageW / 2, footerY, { align: 'center' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text('We wish you a comfortable and memorable stay.', pageW / 2, footerY + 14, { align: 'center' });

  // Divider
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.5);
  doc.line(margin, footerY + 28, pageW - margin, footerY + 28);

  // Legal & reference row
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    'Electronically generated · Valid without a signature · Please retain for your records.',
    margin,
    footerY + 44
  );
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.ink);
  doc.text(`${BRAND.name} · Ref ${data.bookingCode}`, pageW - margin, footerY + 44, { align: 'right' });

  // ===== PAID WATERMARK (only for confirmed/completed bookings) =====
  // Drawn as a final overlay so the word "PAID" sits ON TOP of every section and
  // is never covered by section content. Rendered on every page.
  if (isConfirmedBooking) {
    const pageHForWm = doc.internal.pageSize.getHeight();
    const totalPagesPaid = doc.getNumberOfPages();
    for (let p = 1; p <= totalPagesPaid; p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      // @ts-ignore — jspdf typings don't expose GState directly in older builds
      doc.setGState(new (doc as any).GState({ opacity: 0.22 }));
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...BRAND.primary);
      const wmText = 'PAID';
      // Render PAID as a tasteful diagonal stamp — clearly visible across the
      // page but not so huge that it dominates the document. We rotate -30°
      // (classic "rubber stamp" angle) and centre it on the page.
      // 72pt baseline + 70% bump → ~122pt diagonal stamp.
      const wmFontSize = 72 * 1.7;
      doc.setFontSize(wmFontSize);
      const textW = doc.getTextWidth(wmText);
      const capPerPt = 0.72;
      const capH = wmFontSize * capPerPt;
      // Centre the rotated word visually on the page.
      const anchorX = pageW / 2 - textW / 2;
      const anchorY = pageHForWm / 2 + capH / 2;
      doc.text(wmText, anchorX, anchorY, { angle: -30 });
      doc.restoreGraphicsState();
    }
  }

  // ===== PREVIEW WATERMARK (only when previewing in-app) =====
  // Drawn LAST so it overlays all content on every page. Reasonably faint but unmistakably "PREVIEW".
  if (options.preview) {
    const pageH = doc.internal.pageSize.getHeight();
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      // @ts-ignore — jspdf typings don't expose GState directly
      doc.setGState(new (doc as any).GState({ opacity: 0.18 }));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(140);
      doc.setTextColor(150, 150, 150);
      doc.text('PREVIEW', pageW / 2, pageH / 2, {
        align: 'center',
        baseline: 'middle',
        angle: -28,
      });
      // Small caption near the bottom for clarity
      // @ts-ignore
      doc.setGState(new (doc as any).GState({ opacity: 0.55 }));
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(
        'PREVIEW — not a valid receipt. Download to obtain the official copy.',
        pageW / 2,
        pageH - 24,
        { align: 'center' }
      );
      // Traceability line — identifies who generated this preview, so leaked screenshots are attributable.
      const tracePieces = [
        data.guestEmail ? `Generated for ${data.guestEmail}` : 'Generated for guest',
        `on ${format(new Date(), 'MMM d, yyyy · h:mm:ss a')}`,
        `· Ref ${data.bookingCode}`,
      ];
      // @ts-ignore
      doc.setGState(new (doc as any).GState({ opacity: 0.7 }));
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 120);
      doc.text(tracePieces.join(' '), pageW / 2, pageH - 12, { align: 'center' });
      doc.restoreGraphicsState();
    }
  }

  return doc;
}

function drawSectionHeader(
  doc: jsPDF,
  title: string,
  margin: number,
  y: number,
  pageW: number
) {
  // Stronger contrast: thicker primary-coloured accent bar + heavier, slightly larger,
  // letter-spaced title in pure ink, with a darker rule line beside it.
  doc.setFillColor(...BRAND.primary);
  doc.rect(margin, y - 11, 4, 16, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  // @ts-ignore — setCharSpace exists at runtime in jsPDF
  if (typeof (doc as any).setCharSpace === 'function') (doc as any).setCharSpace(0.6);
  doc.text(title, margin + 12, y);
  // @ts-ignore
  if (typeof (doc as any).setCharSpace === 'function') (doc as any).setCharSpace(0);
  doc.setDrawColor(...BRAND.muted);
  doc.setLineWidth(0.7);
  doc.line(margin + 12 + doc.getTextWidth(title) + 10, y - 3, pageW - margin, y - 3);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

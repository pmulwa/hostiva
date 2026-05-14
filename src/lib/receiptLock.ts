/**
 * Tracks bookings whose PDF receipt has been downloaded.
 * Once a receipt is downloaded, the booking is treated as finalised and
 * the guest forfeits the right to cancel for a refund.
 *
 * Persistence is two-tier:
 *  1. Database: `bookings.receipt_downloaded_at` (cross-device, authoritative).
 *  2. localStorage: `hostly_receipt_downloaded_<bookingId>` (instant local
 *     fallback so the UI updates without an extra round-trip and still works
 *     offline / when the DB write briefly fails).
 *
 * Synchronous helpers (`isReceiptDownloaded`, `markReceiptDownloadedLocal`)
 * keep the existing UI gating fast. The async helpers
 * (`persistReceiptDownload`, `isReceiptDownloadedRemote`) talk to Supabase.
 */
import { supabase } from '@/integrations/supabase/client';

const KEY = (bookingId: string) => `hostly_receipt_downloaded_${bookingId}`;

/** Set the local (browser) flag immediately. Safe to call from anywhere. */
export function markReceiptDownloadedLocal(bookingId: string): void {
  try {
    localStorage.setItem(KEY(bookingId), '1');
  } catch {
    // ignore — storage may be unavailable
  }
}

/** Synchronous check used by UI gating. Reads only the local flag. */
export function isReceiptDownloaded(bookingId: string): boolean {
  try {
    return localStorage.getItem(KEY(bookingId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Persist the download to the database AND mirror locally.
 * Idempotent — safe to call multiple times.
 */
export async function persistReceiptDownload(bookingId: string): Promise<void> {
  // Always update local first so the UI reflects the lock instantly.
  markReceiptDownloadedLocal(bookingId);
  try {
    await supabase
      .from('bookings')
      .update({ receipt_downloaded_at: new Date().toISOString() } as any)
      .eq('id', bookingId)
      .is('receipt_downloaded_at', null); // don't overwrite the original timestamp
  } catch (err) {
    console.warn('[receiptLock] failed to persist to DB:', err);
  }
}

/**
 * Hydrate the local flag from the database for a set of bookings.
 * Call once when a list of bookings is loaded so the lock works on a fresh
 * device / browser.
 */
export async function hydrateReceiptLocksFromBookings(
  bookings: Array<{ id: string; receipt_downloaded_at?: string | null }>
): Promise<void> {
  for (const b of bookings) {
    if ((b as any).receipt_downloaded_at) {
      markReceiptDownloadedLocal(b.id);
    }
  }
}

/** Back-compat alias — old call sites used this name. */
export const markReceiptDownloaded = markReceiptDownloadedLocal;

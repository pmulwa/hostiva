// Detects attempts to share contact information in chat messages.
// Catches numeric phone formats AND word-form numbers ("five five five..."),
// emails, URLs, and common off-platform messaging-app handles.

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

// Replace number-words in a string with their digits, so "five five five" becomes "555".
function normalizeWordNumbers(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (m) => NUMBER_WORDS[m] || m);
}

export type ContactDetection = {
  detected: boolean;
  reasons: string[];
};

export function detectContactInfo(text: string): ContactDetection {
  const reasons: string[] = [];
  if (!text || text.trim().length === 0) return { detected: false, reasons };

  // 1) Long digit run in raw text (covers "5551234", "+1-415-555-1234", etc.)
  if (/\d{4,}/.test(text)) reasons.push('phone number');

  // 2) Phone-shaped pattern: digit groups separated by spaces/dashes/dots/parens, total ≥7 digits
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length >= 7 && /[\d][\s.\-()+\d]{6,}\d/.test(text)) {
    if (!reasons.includes('phone number')) reasons.push('phone number');
  }

  // 3) Word-form numbers: "five five five one two three four" -> 5551234
  const normalized = normalizeWordNumbers(text);
  const normalizedDigits = normalized.replace(/[^0-9]/g, '');
  if (normalizedDigits.length >= 7 && normalizedDigits !== digitsOnly) {
    reasons.push('phone number (spelled out)');
  }

  // 4) Email
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) reasons.push('email address');

  // 5) URL / domain
  if (/(https?:\/\/|www\.)\S+/i.test(text) || /\b[a-z0-9-]+\.(com|net|org|io|co|me|app)\b/i.test(text)) {
    reasons.push('website link');
  }

  // 6) Off-platform messaging handles
  if (/\b(whats\s?app|telegram|signal|wechat|viber|messenger|insta(gram)?|snapchat|skype)\b/i.test(text)) {
    reasons.push('off-platform messaging app');
  }
  if (/(?:^|\s)@[a-z0-9_.]{3,}/i.test(text)) {
    reasons.push('social handle');
  }

  return { detected: reasons.length > 0, reasons: Array.from(new Set(reasons)) };
}

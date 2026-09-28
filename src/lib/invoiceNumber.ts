import { db } from './db';

// Auto-generated invoice number, styled after the numbers already used on
// some of Nesf Shawaya's invoices (e.g. "9k865ZRY 0002", "3Z324QPV 0013",
// "2X763UKF 0037", "6U437IKL 0053") instead of the old plain sequential
// "INV-0001" scheme.
//
// Format: an 8-character random code — 1 digit, 1 letter, 3 digits, 3
// letters (digits and letters random each time; letters uppercase — 15 of
// the 16 letters across those 4 existing numbers are uppercase, the one
// lowercase "k" reads as a one-off manual slip rather than the pattern) —
// then a space, then a running number.
//
// That running number isn't a strict per-invoice +1 — the existing ones
// jump by double digits between invoices (0002 -> 0013 -> 0037 -> 0053,
// i.e. +11, +24, +16), which is the "trend" to continue rather than restart.
// So each new invoice's number picks up from the highest running number
// seen so far across ALL invoices in this style (any client), plus a random
// jump in that same rough range, rather than resetting or counting 1:1.
const RUNNING_NUMBER_PATTERN = /^\d[A-Z]\d{3}[A-Z]{3} (\d{4,})$/;

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function randomLetter(): string {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

function randomPrefix(): string {
  return `${randomDigit()}${randomLetter()}${randomDigit()}${randomDigit()}${randomDigit()}${randomLetter()}${randomLetter()}${randomLetter()}`;
}

async function nextRunningNumber(): Promise<number> {
  const existing = await db.invoice.findMany({ select: { invoiceNumber: true } });
  let max = 40; // baseline close to the highest existing number (0053) if none in this style exist yet
  for (const { invoiceNumber } of existing) {
    const match = invoiceNumber.match(RUNNING_NUMBER_PATTERN);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  const jump = 8 + Math.floor(Math.random() * 23); // +8 to +30, in line with the observed +11/+24/+16 gaps
  return max + jump;
}

// Caller should catch a unique-constraint error on create and call this
// again — same retry shape as the old sequential scheme (a fresh random
// prefix makes a repeat collision astronomically unlikely).
export async function generateInvoiceNumber(): Promise<string> {
  const n = await nextRunningNumber();
  return `${randomPrefix()} ${String(n).padStart(4, '0')}`;
}

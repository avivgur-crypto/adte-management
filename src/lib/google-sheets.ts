/**
 * Google Sheets API client using a service account.
 *
 * Reads from spreadsheets. Requires in .env.local:
 *   - GOOGLE_SHEETS_CLIENT_EMAIL
 *   - GOOGLE_SHEETS_PRIVATE_KEY (PEM string; escaped newlines as \n are handled)
 */

import { google } from "googleapis";

const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "";
const PRIVATE_KEY_RAW = process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "";

function getAuthClient() {
  if (!CLIENT_EMAIL || !PRIVATE_KEY_RAW) {
    throw new Error(
      "Missing Google Sheets env: set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY in .env.local"
    );
  }
  const privateKey = PRIVATE_KEY_RAW.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return auth;
}

/**
 * Return the Sheets API client (v4) authenticated with the service account.
 */
export function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

/**
 * Read a range from a spreadsheet as a 2D array of values.
 *
 * @param spreadsheetId - Sheet ID from the URL
 * @param range - A1 notation, e.g. "Sheet1!A1:Z100" or "Sheet1"
 */
export async function getSheetValues(
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const rows = res.data.values as string[][] | undefined;
  return rows ?? [];
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { google, sheets_v4, drive_v3 } from 'googleapis';
import { toZonedTime, format } from 'date-fns-tz';

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const DAY_NAMES: Record<number, string> = {
  2: 'MARTES',
  3: 'MIERCOLES',
  4: 'JUEVES',
  5: 'VIERNES',
  6: 'SABADO',
};

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheetsClient: sheets_v4.Sheets | null = null;

  onModuleInit() {
    const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!rawJson) {
      this.logger.warn('Google Sheets not configured — GOOGLE_SERVICE_ACCOUNT_JSON missing');
      return;
    }

    try {
      const credentials = JSON.parse(rawJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      this.sheetsClient = google.sheets({ version: 'v4', auth });
      this.logger.log('GoogleSheetsService initialized');
    } catch (err) {
      this.logger.error('Failed to initialize GoogleSheetsService', err?.message);
    }
  }

  async markSlot(spreadsheetId: string, date: Date, staffName: string): Promise<void> {
    await this.updateSlot(spreadsheetId, date, staffName, { red: 0, green: 0, blue: 0 });
  }

  async clearSlot(spreadsheetId: string, date: Date, staffName: string): Promise<void> {
    await this.updateSlot(spreadsheetId, date, staffName, { red: 1, green: 1, blue: 1 });
  }

  private async updateSlot(
    spreadsheetId: string,
    date: Date,
    staffName: string,
    color: { red: number; green: number; blue: number },
  ): Promise<void> {
    if (!this.sheetsClient) return;

    try {
      const a1 = await this.findCell(spreadsheetId, date, staffName);
      if (!a1) {
        this.logger.warn(`Sheets: cell not found for ${date.toISOString()} / staff "${staffName}"`);
        return;
      }

      await this.sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: this.a1ToGridRange(a1),
              cell: { userEnteredFormat: { backgroundColor: color } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          }],
        },
      });

      const action = color.red === 0 ? 'marked black' : 'cleared';
      this.logger.log(`Sheets: ${action} cell ${a1} for "${staffName}" on ${date.toISOString()}`);
    } catch (err) {
      this.logger.error(`Sheets updateSlot failed for "${staffName}"`, err?.message);
    }
  }

  private async findCell(spreadsheetId: string, date: Date, staffName: string): Promise<string | null> {
    const zoned = toZonedTime(date, TIMEZONE);
    const dayOfWeek = zoned.getDay();
    const dayName = DAY_NAMES[dayOfWeek];

    if (!dayName) {
      this.logger.warn(`Sheets: day ${dayOfWeek} is not a working day`);
      return null;
    }

    const dayLabel = `${dayName} ${zoned.getDate()}`;
    const timeLabel = format(zoned, 'H:mm', { timeZone: TIMEZONE });
    const normalizedStaff = staffName.trim().toUpperCase();

    const res = await this.sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: 'A:U',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = res.data.values ?? [];

    // Find the row with the matching day label (col A)
    let dayLabelRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const cellA = (rows[i]?.[0] ?? '').toString().trim().toUpperCase();
      if (cellA === dayLabel.toUpperCase()) {
        dayLabelRowIdx = i;
        break;
      }
    }

    if (dayLabelRowIdx === -1) {
      this.logger.warn(`Sheets: day row "${dayLabel}" not found in sheet`);
      return null;
    }

    // Header is always the next row
    const headerRow = rows[dayLabelRowIdx + 1] ?? [];

    // Find the time column in the header row
    let timeColIdx = -1;
    for (let c = 1; c < headerRow.length; c++) {
      const cell = (headerRow[c] ?? '').toString().trim();
      if (cell === timeLabel) {
        timeColIdx = c;
        break;
      }
    }

    if (timeColIdx === -1) {
      this.logger.warn(`Sheets: time "${timeLabel}" not found in header for day "${dayLabel}"`);
      return null;
    }

    // Find the staff row (starts 2 rows below the day label)
    let staffRowIdx = -1;
    for (let i = dayLabelRowIdx + 2; i < rows.length; i++) {
      const cellA = (rows[i]?.[0] ?? '').toString().trim().toUpperCase();
      // Stop if we hit the next day label or an empty row followed by a new block
      if (!cellA) break;
      if (cellA === normalizedStaff) {
        staffRowIdx = i;
        break;
      }
    }

    if (staffRowIdx === -1) {
      this.logger.warn(`Sheets: staff "${staffName}" not found under day "${dayLabel}"`);
      return null;
    }

    return `${this.colIndexToLetter(timeColIdx)}${staffRowIdx + 1}`;
  }

  private colIndexToLetter(index: number): string {
    let result = '';
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  // ─── Drive: auto-share with service account ──────────────────

  getServiceAccountEmail(): string | null {
    const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!rawJson) return null;
    try {
      return JSON.parse(rawJson).client_email ?? null;
    } catch {
      return null;
    }
  }

  async shareWithServiceAccount(
    spreadsheetId: string,
    businessTokens: { accessToken: string; refreshToken: string; tokenExpiry?: Date | null },
  ): Promise<void> {
    const serviceAccountEmail = this.getServiceAccountEmail();
    if (!serviceAccountEmail) {
      this.logger.warn('Sheets: cannot auto-share — GOOGLE_SERVICE_ACCOUNT_JSON not set');
      return;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2Client.setCredentials({
      access_token: businessTokens.accessToken,
      refresh_token: businessTokens.refreshToken,
      expiry_date: businessTokens.tokenExpiry?.getTime(),
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: serviceAccountEmail },
        fields: 'id',
        sendNotificationEmail: false,
      });
      this.logger.log(`Sheets: shared "${spreadsheetId}" with service account ${serviceAccountEmail}`);
    } catch (err) {
      // 400 with "already exists" means it was already shared — not an error
      const msg: string = err?.message ?? '';
      if (msg.includes('already')) {
        this.logger.log(`Sheets: service account already has access to "${spreadsheetId}"`);
      } else {
        this.logger.error(`Sheets: failed to share "${spreadsheetId}"`, msg);
        throw err;
      }
    }
  }

  private a1ToGridRange(a1: string): sheets_v4.Schema$GridRange {
    const match = a1.match(/^([A-Z]+)(\d+)$/);
    if (!match) throw new Error(`Invalid A1 notation: ${a1}`);

    const colStr = match[1];
    const rowNum = parseInt(match[2], 10);

    let colIndex = 0;
    for (let i = 0; i < colStr.length; i++) {
      colIndex = colIndex * 26 + (colStr.charCodeAt(i) - 64);
    }
    colIndex -= 1;

    const rowIndex = rowNum - 1;

    return {
      sheetId: 0,
      startRowIndex: rowIndex,
      endRowIndex: rowIndex + 1,
      startColumnIndex: colIndex,
      endColumnIndex: colIndex + 1,
    };
  }
}

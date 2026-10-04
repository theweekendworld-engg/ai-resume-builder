/**
 * Google Calendar v3, the three calls the journey needs. Thin: no SDK, so
 * the dependency surface is `fetch` and the tests can replace it.
 */

export type CalendarEvent = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: Array<{ email?: string; responseStatus?: string; self?: boolean }>;
    organizer?: { email?: string };
};

export class CalendarError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'CalendarError';
    }
}

const BASE = 'https://www.googleapis.com/calendar/v3';

async function call<T>(accessToken: string, path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
    const response = await fetchImpl(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new CalendarError(response.status, `Calendar ${response.status}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
}

export async function listEvents(
    accessToken: string,
    window: { timeMin: Date; timeMax: Date },
    fetchImpl: typeof fetch = fetch,
): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const params = new URLSearchParams({
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '250',
            showDeleted: 'true',
            timeMin: window.timeMin.toISOString(),
            timeMax: window.timeMax.toISOString(),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const json = await call<{ items?: CalendarEvent[]; nextPageToken?: string }>(accessToken, `/calendars/primary/events?${params}`, {}, fetchImpl);
        events.push(...(json.items ?? []));
        pageToken = json.nextPageToken;
        if (!pageToken) break;
    }
    return events;
}

export async function insertEvent(
    accessToken: string,
    event: { summary: string; description: string; start: Date; minutes: number; timeZone: string | null },
    fetchImpl: typeof fetch = fetch,
): Promise<CalendarEvent> {
    const end = new Date(event.start.getTime() + event.minutes * 60_000);
    return call<CalendarEvent>(accessToken, '/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify({
            summary: event.summary,
            description: event.description,
            start: { dateTime: event.start.toISOString(), ...(event.timeZone ? { timeZone: event.timeZone } : {}) },
            end: { dateTime: end.toISOString(), ...(event.timeZone ? { timeZone: event.timeZone } : {}) },
            reminders: { useDefault: true },
        }),
    }, fetchImpl);
}

export async function calendarTimeZone(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const json = await call<{ value?: string }>(accessToken, '/users/me/settings/timezone', {}, fetchImpl);
        return json.value ?? null;
    } catch {
        return null;
    }
}

export function eventStart(event: CalendarEvent): Date | null {
    const value = event.start?.dateTime ?? event.start?.date;
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

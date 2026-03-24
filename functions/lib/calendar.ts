let cachedToken: { token: string; expiresAt: number } | null = null;

export function isCalendarConfigured(): boolean {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.CALENDAR_USER_EMAIL);
}

export async function getGraphToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Calendar not configured: missing GRAPH_TENANT_ID, GRAPH_CLIENT_ID, or GRAPH_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Graph token request failed:", res.status, text);
    throw new Error(`Failed to get Graph token: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

function stripTimezone(datetime: string): string {
  // Remove trailing Z or ±HH:MM offset — Graph wants bare datetime with separate timeZone field
  return datetime.replace(/([Zz]|[+-]\d{2}:\d{2})$/, "");
}

function addMinutes(datetime: string, minutes: number): string {
  const bare = stripTimezone(datetime);
  const date = new Date(bare);
  date.setMinutes(date.getMinutes() + minutes);

  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function createCalendarEvent(
  title: string,
  datetime: string,
  userEmail?: string
): Promise<{ id: string; webLink: string }> {
  const email = userEmail || process.env.CALENDAR_USER_EMAIL;
  if (!email) {
    throw new Error("No user email provided and CALENDAR_USER_EMAIL not set");
  }

  const token = await getGraphToken();
  const startDateTime = stripTimezone(datetime);
  const endDateTime = addMinutes(datetime, 15);

  const body = {
    subject: title,
    start: { dateTime: startDateTime, timeZone: "Central Standard Time" },
    end: { dateTime: endDateTime, timeZone: "Central Standard Time" },
    isReminderOn: true,
    reminderMinutesBeforeStart: 1440,
    showAs: "free",
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${email}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Graph calendar event creation failed:", res.status, text);
    throw new Error(`Failed to create calendar event: ${res.status}`);
  }

  const data = await res.json();
  return { id: data.id, webLink: data.webLink };
}

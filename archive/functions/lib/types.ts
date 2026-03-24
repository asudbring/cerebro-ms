/** Shared types for Open Brain */

/** A single row from the thoughts table. */
export interface ThoughtRow {
  id: string;
  content: string;
  embedding?: number[];
  metadata: ThoughtMetadata;
  status: string;
  file_url?: string | null;
  file_type?: string | null;
  created_at: string;
  updated_at: string;
}

/** Structured metadata extracted by the LLM from a raw thought. */
export interface ThoughtMetadata {
  title?: string;
  type?: string;
  people?: string[];
  action_items?: string[];
  tags?: string[];
  source?: string;
  has_reminder?: boolean;
  reminder_title?: string;
  reminder_datetime?: string;
  has_file?: boolean;
  file_name?: string;
  file_description?: string;
  file_url?: string;
  [key: string]: unknown;
}

/** A search result from match_thoughts(). */
export interface SearchResult {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  similarity: number;
  created_at: string;
}

/** Brain stats overview. */
export interface BrainStats {
  total_thoughts: number;
  earliest: string | null;
  latest: string | null;
  top_types: { type: string; count: number }[];
  top_people: { person: string; count: number }[];
}

/** Teams Outgoing Webhook request body. */
export interface TeamsWebhookPayload {
  type: string;
  id: string;
  timestamp: string;
  localTimestamp: string;
  serviceUrl: string;
  channelId: string;
  from: {
    id: string;
    name: string;
    aadObjectId?: string;
  };
  conversation: {
    id: string;
    name?: string;
    conversationType?: string;
    tenantId?: string;
    isGroup?: boolean;
  };
  recipient: {
    id: string;
    name: string;
  };
  text: string;
  textFormat?: string;
  attachments?: unknown[];
  entities?: unknown[];
  channelData?: {
    teamsChannelId?: string;
    teamsTeamId?: string;
    channel?: { id: string };
    team?: { id: string };
    tenant?: { id: string };
  };
}

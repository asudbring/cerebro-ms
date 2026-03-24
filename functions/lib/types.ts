// Metadata extracted by AI from thought content
export interface ThoughtMetadata {
  title: string;
  type: 'idea' | 'task' | 'person_note' | 'project_update' | 'meeting_note' | 'decision' | 'reflection' | 'reference' | 'observation';
  topics: string[];
  people: string[];
  action_items: string[];
  has_reminder: boolean;
  reminder_title: string;
  reminder_datetime: string; // ISO 8601
  has_file: boolean;
  file_name: string;
  file_description: string;
  source: 'mcp' | 'teams';
}

// A thought record from the database
export interface Thought {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  status: 'open' | 'done' | 'deleted';
  file_url: string | null;
  file_type: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

// Search result with similarity score
export interface SearchResult extends Thought {
  similarity: number;
}

// Digest channel for Teams delivery
export interface DigestChannel {
  id: string;
  source: string;
  teams_service_url: string | null;
  teams_conversation_id: string | null;
  teams_user_name: string | null;
  enabled: boolean;
  last_digest_at: string | null;
  created_at: string;
}

// Embedding result from Azure OpenAI
export interface EmbeddingResult {
  embedding: number[];
}

// Calendar event creation request
export interface CalendarEvent {
  title: string;
  datetime: string; // ISO 8601
  userEmail: string;
}

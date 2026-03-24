-- ============================================================================
-- 04-create-digest-channels.sql
-- Digest channel tracking for proactive delivery to Teams
-- ============================================================================

-- digest_channels: tracks capture channels that receive scheduled digests
CREATE TABLE IF NOT EXISTS digest_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'teams',
    teams_service_url TEXT,
    teams_conversation_id TEXT,
    teams_user_name TEXT,
    enabled BOOLEAN DEFAULT true,
    last_digest_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_teams_channel UNIQUE (source, teams_conversation_id)
);

-- Index for efficient cron queries: find all enabled channels by source
CREATE INDEX IF NOT EXISTS idx_digest_channels_enabled
    ON digest_channels (source) WHERE enabled = true;

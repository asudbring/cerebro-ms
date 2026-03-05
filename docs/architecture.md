# System Architecture

## Overview

Open Brain (Microsoft Edition) is a personal knowledge base built on Azure. It captures raw thoughts via Microsoft Teams (through Power Automate), generates vector embeddings with Azure OpenAI, stores everything in PostgreSQL with pgvector, and exposes an MCP server so any AI assistant can search and write to your brain.

The architecture has three parts: **capture** (thoughts in), **retrieval** (thoughts out), and **digests** (automated summaries).

## Data Flow

```
                         CAPTURE PATH
┌────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Teams       │────▶│ Power        │────▶│ Azure Function:  │────▶│ Azure OpenAI     │
│ keyword msg │     │ Automate     │     │ ingest-thought   │     │ embed + classify │
└────────────┘     └──────────────┘     └──────────────────┘     └──────────────────┘
                                               │                         │
                                               │    ┌────────────────────┘
                                               ▼    ▼
                                       ┌──────────────────┐
                                       │ Azure PostgreSQL │
                                       │ thoughts table   │
                                       │ (text + vector   │
                                       │  + metadata      │
                                       │  + status)       │
                                       └──────────────────┘
                                               ▲    │
                                               │    │
                         RETRIEVAL PATH        │    │         DIGEST PATH
┌────────────┐     ┌──────────────────┐        │    │   ┌──────────────────┐
│ Any AI:    │────▶│ Azure Function:  │────────┘    └──▶│ Azure Function:  │
│ Claude,    │     │ open-brain-mcp   │                 │ daily/weekly     │
│ ChatGPT,   │     │ (MCP server)     │                 │ digest           │
│ Copilot... │     └──────────────────┘                 └──────────────────┘
└────────────┘                                                  │
                                                                ▼
                                                   ┌──────────────────┐
                                                   │ Power Automate   │
                                                   │ → Teams + Email  │
                                                   └──────────────────┘
```

## The Stack

| Layer | Tool | Job |
|-------|------|-----|
| **Interface** | Microsoft Teams | Where you capture — type a keyword, post a thought |
| **Automation** | Power Automate | Where routing happens — connects Teams to Azure Functions |
| **Transport** | Azure Functions | Where processing happens — four HTTP-triggered functions |
| **Intelligence** | Azure OpenAI | Where understanding happens — embeddings (meaning) + chat (metadata + digests) |
| **Memory** | Azure PostgreSQL + pgvector | Where truth lives — raw text, vector embeddings, structured metadata, task status |
| **Protocol** | MCP Server | How AIs connect — standard protocol for tool use |

## How Embedding Works

When you capture a thought, two things happen in parallel:

1. **Embedding:** Azure OpenAI converts the text into a 1536-dimensional vector using `text-embedding-3-small`. This vector captures the *meaning* of the thought, not just keywords. "Sarah's thinking about leaving" and "career changes" produce similar vectors even though they share no words.

2. **Metadata extraction:** `gpt-4o-mini` reads the text and returns structured JSON — title, type, people mentioned, action items, tags, and completion intent. This is a convenience layer for browsing and filtering.

Both are stored together in one row. The embedding powers semantic search. The metadata powers browsing and stats.

## How Search Works

When you ask "What did I capture about career changes?":

1. Your query gets embedded into the same 1536-dimensional space
2. PostgreSQL's pgvector finds the closest thoughts using cosine distance (`<=>`)
3. The `match_thoughts()` function returns results ranked by similarity
4. Results above the threshold (default 0.3) come back with their original text and metadata

This is why it works semantically. You don't need to remember the exact words you used — just the concept.

## How Task Completion Works

When you type `done: vnet troubleshooting docs`:

1. The `done:` prefix is detected (or the AI detects completion intent in natural language)
2. An embedding is generated for the task description
3. The system searches for the closest matching open task by vector similarity
4. If a match is found (similarity > 0.3), that task is marked as `done`
5. The completion thought is also stored as a new entry
6. Reply confirms what was marked done

Reopening works the same way — `reopen:` searches done tasks and sets them back to open.

## The Four Functions

### ingest-thought
- **Trigger:** HTTP POST from Power Automate
- **Validates:** API key via header or query param
- **Does:** Strip @mention → embed + classify in parallel → detect completion/reopen → insert to DB → return reply JSON
- **Returns:** JSON with reply text, type, title, and markedDone/reopened ID

### open-brain-mcp
- **Trigger:** HTTP POST/GET with access key auth
- **Protocol:** JSON-RPC (MCP standard)
- **Tools:** search_thoughts, browse_recent, brain_stats, capture_thought
- **Returns:** MCP-formatted responses that AI clients understand

### daily-digest
- **Trigger:** HTTP GET from Power Automate (scheduled daily)
- **Does:** Query last 24h thoughts + completed tasks → AI-generate summary → return JSON
- **Returns:** title, summary (markdown for Teams), summaryHtml (for email), thoughtCount

### weekly-digest
- **Trigger:** HTTP GET from Power Automate (scheduled weekly)
- **Does:** Query last 7 days → AI-generate theme analysis + open loops → return JSON
- **Returns:** Same format as daily, plus totalThoughts count

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Teams → Power Automate | Microsoft 365 authentication (built-in) |
| Power Automate → Function | API access key in URL query parameter |
| Client → MCP | Access key via header (`x-brain-key`) or query param (`?key=`) |
| Function → Database | Connection string with SSL required |
| Database | Row Level Security (app role only) |
| Network | Azure PostgreSQL firewall rules |

## Why This Architecture

**Vector search over categorization:** The original second-brain pattern routes thoughts into categories (People, Projects, Ideas, Admin). This system embeds *everything* into a shared vector space. You don't need to decide categories at capture time — similarity search finds what you need regardless of how it was filed.

**Power Automate over webhooks:** Microsoft is retiring Office 365 Connectors and steering away from outgoing webhooks. Power Automate is the future-proof integration layer for Teams, and adds scheduling for digests and email delivery for free.

**MCP over custom APIs:** The Model Context Protocol means any AI client that supports MCP can search and write to your brain. One server, every tool. As new AI assistants ship, they just connect to the same URL.

**Azure Functions over always-on servers:** Serverless = you pay for execution time only. For personal use (a few thoughts per day), this is effectively free on the consumption plan.

**Task completion via semantic search:** Instead of requiring exact task IDs or titles, you describe what you finished and the system finds the closest match. This keeps the UX natural — you type how you think, not how a database expects.

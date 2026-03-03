# System Architecture

## Overview

Open Brain (Microsoft Edition) is a personal knowledge base built on Azure. It captures raw thoughts via Microsoft Teams, generates vector embeddings with Azure OpenAI, stores everything in PostgreSQL with pgvector, and exposes an MCP server so any AI assistant can search and write to your brain.

The architecture has two halves: **capture** (thoughts in) and **retrieval** (thoughts out).

## Data Flow

```
                         CAPTURE PATH
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Teams       │────▶│ Azure Function:  │────▶│ Azure OpenAI     │
│ @Brain msg  │     │ ingest-thought   │     │ embed + classify │
└────────────┘     └──────────────────┘     └──────────────────┘
                           │                         │
                           │    ┌────────────────────┘
                           ▼    ▼
                   ┌──────────────────┐
                   │ Azure PostgreSQL │
                   │ thoughts table   │
                   │ (text + vector   │
                   │  + metadata)     │
                   └──────────────────┘
                           ▲    │
                           │    │
                         RETRIEVAL PATH
┌────────────┐     ┌──────────────────┐
│ Any AI:    │────▶│ Azure Function:  │
│ Claude,    │     │ open-brain-mcp   │
│ ChatGPT,   │     │ (MCP server)     │
│ Cursor...  │     └──────────────────┘
└────────────┘
```

## The Stack

| Layer | Tool | Job |
|-------|------|-----|
| **Interface** | Microsoft Teams | Where you capture — type a thought, @mention the bot |
| **Transport** | Azure Functions | Where processing happens — two HTTP-triggered functions |
| **Intelligence** | Azure OpenAI | Where understanding happens — embeddings (meaning) + chat (metadata) |
| **Memory** | Azure PostgreSQL + pgvector | Where truth lives — raw text, vector embeddings, structured metadata |
| **Protocol** | MCP Server | How AIs connect — standard protocol for tool use |

## How Embedding Works

When you capture a thought, two things happen in parallel:

1. **Embedding:** Azure OpenAI converts the text into a 1536-dimensional vector using `text-embedding-3-small`. This vector captures the *meaning* of the thought, not just keywords. "Sarah's thinking about leaving" and "career changes" produce similar vectors even though they share no words.

2. **Metadata extraction:** `gpt-4o-mini` reads the text and returns structured JSON — title, type, people mentioned, action items, tags. This is a convenience layer for browsing and filtering.

Both are stored together in one row. The embedding powers semantic search. The metadata powers browsing and stats.

## How Search Works

When you ask "What did I capture about career changes?":

1. Your query gets embedded into the same 1536-dimensional space
2. PostgreSQL's pgvector finds the closest thoughts using cosine distance (`<=>`)
3. The `match_thoughts()` function returns results ranked by similarity
4. Results above the threshold (default 0.5) come back with their original text and metadata

This is why it works semantically. You don't need to remember the exact words you used — just the concept.

## The Two Functions

### ingest-thought
- **Trigger:** HTTP POST from Teams Outgoing Webhook
- **Validates:** HMAC-SHA256 signature from Teams
- **Does:** Strip @mention → embed + classify in parallel → insert to DB → return reply JSON
- **Returns:** JSON that Teams displays as a threaded reply

### open-brain-mcp
- **Trigger:** HTTP POST/GET with access key auth
- **Protocol:** JSON-RPC (MCP standard)
- **Tools:** search_thoughts, browse_recent, brain_stats, capture_thought
- **Returns:** MCP-formatted responses that AI clients understand

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Teams → Function | HMAC-SHA256 signature validation |
| Client → MCP | Access key via header (`x-brain-key`) or query param (`?key=`) |
| Function → Database | Connection string with SSL required |
| Database | Row Level Security (app role only) |
| Network | Azure PostgreSQL firewall rules |

## Why This Architecture

**Vector search over categorization:** The original second-brain pattern routes thoughts into categories (People, Projects, Ideas, Admin). This system embeds *everything* into a shared vector space. You don't need to decide categories at capture time — similarity search finds what you need regardless of how it was filed.

**MCP over custom APIs:** The Model Context Protocol means any AI client that supports MCP can search and write to your brain. One server, every tool. As new AI assistants ship, they just connect to the same URL.

**Azure Functions over always-on servers:** Serverless = you pay for execution time only. For personal use (a few thoughts per day), this is effectively free on the consumption plan.

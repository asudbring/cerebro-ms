# Companion Prompts

Five prompts that cover the full Open Brain lifecycle: migrate your existing AI memories, bring over your existing second brain, discover personalized use cases, build the daily capture habit, and run a weekly review.

## Order of Use

| # | Prompt | When | Requires MCP? |
|---|--------|------|---------------|
| 1 | [Memory Migration](01-memory-migration.md) | Right after setup — run once per AI platform | Yes |
| 2 | [Second Brain Migration](02-second-brain-migration.md) | After setup, if you have existing notes to bring over | Yes |
| 3 | [Open Brain Spark](03-open-brain-spark.md) | When you need capture ideas for your specific workflow | No |
| 4 | [Quick Capture Templates](04-quick-capture-templates.md) | Daily reference while building the habit | No |
| 5 | [Weekly Review](05-weekly-review.md) | Friday afternoon or Sunday evening — ongoing ritual | Yes |

## Getting Started

1. **Start with Memory Migration** — run it in Claude or ChatGPT (whichever has the most memory about you) with your Open Brain MCP connected. This frontloads your brain with context every AI can access.

2. **If you have an existing second brain** (Microsoft Lists, Notion, Obsidian, etc.), run the **Second Brain Migration** next. Export your data and paste it in batches.

3. **Run the Spark** to discover capture patterns specific to your workflow. This generates your "First 5 Captures" list.

4. **Keep the Capture Templates** handy for your first week. They optimize metadata extraction so your brain tags and retrieves accurately. Also covers task completion (`done:`), reopen (`reopen:`), and reminder commands (include a date/time to auto-create calendar events).

5. **The Weekly Review** is the ongoing habit. Run it every Friday or Sunday. It compounds — the more you capture during the week, the more valuable the review becomes.

## Adapted for Microsoft Stack

These prompts reference the MCP tools exposed by the Open Brain Azure Function:

- `capture_thought` — save a thought (used by prompts 1, 2)
- `search_thoughts` — semantic search (used by prompt 5)
- `browse_recent` — list recent thoughts (used by prompt 5)
- `brain_stats` — overview stats (used by prompt 5)

Capture templates are designed for your dedicated Teams capture channel (via Power Automate), or "save this" / "remember this" for MCP-connected AI clients. Thoughts with time/date references automatically create Outlook calendar events with 24-hour advance reminders.

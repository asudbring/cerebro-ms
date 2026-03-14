# Prompt 4: Quick Capture Templates

Nine patterns for capturing thoughts, completing tasks, reopening items, setting reminders, and capturing files. Each one is optimized for clean metadata extraction in your Cerebro's processing pipeline.

## When to Use

Keep these handy as a reference. After a week of capturing, you won't need them — you'll develop your own natural patterns. But they're useful for building the habit early.

## Why Formatting Matters

Your Cerebro's Azure Function uses an LLM to extract metadata from each capture — people, topics, action items, type, and completion intent. These templates are structured to give that LLM clear signals, which means better tagging, better search, better retrieval.

> These are not prompts to paste into AI. These are templates for what you type into your dedicated Teams capture channel or say directly to any MCP-connected AI using "save this" or "remember this."

---

## 1. Decision Capture

**Template:**
```
Decision: [what was decided]. Context: [why]. Owner: [who].
```

**Example:**
```
Decision: Moving the launch to March 15. Context: QA found three blockers in the payment flow. Owner: Rachel.
```

**Why it works:** "Decision" triggers the `task` type. Naming an owner triggers people extraction. The context gives the embedding meaningful content to match against later.

---

## 2. Person Note

**Template:**
```
[Name] — [what happened or what you learned about them].
```

**Example:**
```
Marcus — mentioned he's overwhelmed since the reorg. Wants to move to the platform team. His wife just had a baby.
```

**Why it works:** Leading with a name triggers `person_note` classification and people extraction. Everything after the dash becomes searchable context about that person.

---

## 3. Insight Capture

**Template:**
```
Insight: [the thing you realized]. Triggered by: [what made you think of it].
```

**Example:**
```
Insight: Our onboarding flow assumes users already understand permissions. Triggered by: watching a new hire struggle for 20 minutes with role setup.
```

**Why it works:** "Insight" triggers `idea` type. Including the trigger gives the embedding richer semantic content and helps you remember the original context months later.

---

## 4. Meeting Debrief

**Template:**
```
Meeting with [who] about [topic]. Key points: [the important stuff]. Action items: [what happens next].
```

**Example:**
```
Meeting with design team about the dashboard redesign. Key points: they want to cut three panels, keep the revenue chart, add a trend line. Action items: I send them the API spec by Thursday, they send revised mocks by Monday.
```

**Why it works:** Hits multiple extraction targets at once — people, topics, action items, dates. Dense captures like this are the highest-value entries in your cerebro.

---

## 5. The AI Save

**Template:**
```
Saving from [AI tool]: [the key takeaway or output worth keeping].
```

**Example:**
```
Saving from Claude: Framework for evaluating vendor proposals — score on integration effort (40%), maintenance burden (30%), and switching cost (30%). Weight integration highest because that's where every past vendor has surprised us.
```

**Why it works:** "Saving from [tool]" creates a natural `reference` classification. The content itself becomes searchable across every AI you use. This is how you stop losing good AI output to chat history graveyards.

---

## 6. Task Completion ✅

**Template:**
```
done: [description of what you finished]
```

**Example:**
```
done: vnet troubleshooting documentation
completed: the dashboard redesign spec
finished: setting up Power Automate digest flows
```

**Why it works:** The `done:` prefix triggers completion detection. The system semantically searches for the closest matching open task and marks it as done. You get a confirmation reply showing what was marked.

**Supported prefixes:** `done:`, `completed:`, `finished:`, `shipped:`, `closed:`

**Natural language also works:**
```
I finally finished the vnet troubleshooting docs
```
The AI detects completion intent even without a keyword prefix.

---

## 7. Reopen a Task 🔄

**Template:**
```
reopen: [description of what needs to be reopened]
```

**Example:**
```
reopen: vnet troubleshooting documentation
undo: the dashboard redesign
```

**Why it works:** The `reopen:` prefix triggers a search against completed tasks, finds the closest match, and sets it back to open.

**Supported prefixes:** `reopen:`, `undo:`, `not done:`, `re-open:`

---

## 8. Set a Reminder 📅

**Template:**
```
remind me to [action] by [date/time]
```

**Examples:**
```
remind me to submit the TPS report by Friday at 3pm
I need to follow up with Sarah about the budget review next Tuesday at 10am
remember to renew the SSL cert before March 15
don't forget: team standup prep tomorrow 8:30am
```

**Why it works:** The AI detects time/date references and extracts a reminder title + datetime. The function returns `has_reminder: true` with the details, and Power Automate creates an Outlook calendar event (15-min, shows as Free, 24-hour advance reminder). If no time is specified, it defaults to 09:00 Central Time.

---

## 9. Capture a File (Image, PDF, Doc) 📎

**How:** Just post a file (drag & drop, paste, or attach) in your capture channel. Optionally add a text message for context.

**Examples:**
- Paste a screenshot with no text → AI describes what's in the image
- Attach a PDF with the message "budget proposal from Sarah" → stored + indexed with your note
- Drag in a Word doc → text extracted and embedded for search

**Why it works:** The function detects attachments in the Teams message, downloads the file, uploads it to Azure Blob Storage, and analyzes it (gpt-4o vision for images, text extraction for docs). The analysis is combined with your message text, embedded, and stored. MCP tools include file URLs in search results for retrieval.

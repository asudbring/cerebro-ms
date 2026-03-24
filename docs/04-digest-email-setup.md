# Digest & Email Setup

Cerebro generates AI-powered daily and weekly digest summaries of your captured thoughts. Digests are delivered via:

1. **Teams proactive messages** — posted to any conversation where the bot is active
2. **Email** — sent via Azure Communication Services

---

## How It Works

- **Daily digest**: Runs at 6 AM Central Time (timer trigger) + manual HTTP trigger
- **Weekly digest**: Runs Sunday at noon Central Time (timer trigger) + manual HTTP trigger
- AI generates a structured summary grouping thoughts by theme
- Daily: covers last 24 hours of thoughts + completed tasks
- Weekly: covers last 7 days with trend analysis

The digest function queries the database for recent thoughts, sends them to Azure OpenAI for summarization, then delivers the result through all configured channels (Teams and/or email). If no thoughts exist in the time window, the digest reports that.

---

## Prerequisites

| Prerequisite | Why |
|---|---|
| Function app deployed | Digest functions run here |
| Database with thoughts | Content to summarize |
| Azure OpenAI configured | AI summary generation |
| ACS (for email) | Email delivery |
| Teams bot (for Teams) | Proactive messaging |

> **Note:** Email and Teams are independently optional. You can use one, both, or neither (HTTP-only for testing).

---

## Step 1: ACS Email Configuration

### If Terraform provisioned ACS

```bash
# Get the ACS connection string
az communication list --query "[].{name:name}" -o table
az communication show -n cerebro-acs -g cerebro-rg --query "hostName"

# Get connection string
CONNECTION_STRING=$(az communication list-key -n cerebro-acs -g cerebro-rg --query "primaryConnectionString" -o tsv)
```

### If provisioning manually

```bash
# Create Communication Service
az communication create -n cerebro-acs -g cerebro-rg --location global --data-location unitedstates

# Create Email Service
az communication email create -n cerebro-email -g cerebro-rg --location global --data-location unitedstates

# Create Azure-managed domain (auto-verifies DKIM, SPF, DMARC)
az communication email domain create -n AzureManagedDomain \
  --email-service-name cerebro-email -g cerebro-rg \
  --location global --domain-management AzureManaged

# Link domain to communication service
az communication email domain link \
  --communication-service-name cerebro-acs -g cerebro-rg \
  --domain-id "/subscriptions/YOUR_SUB/resourceGroups/cerebro-rg/providers/Microsoft.Communication/emailServices/cerebro-email/domains/AzureManagedDomain"
```

Wait for domain verification to complete (Azure-managed domains auto-verify DKIM, SPF, and DMARC — this typically takes a few minutes).

---

## Step 2: Configure Environment Variables

```bash
az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
  ACS_CONNECTION_STRING="endpoint=https://cerebro-acs.communication.azure.com/;accesskey=..." \
  ACS_EMAIL_SENDER="DoNotReply@YOUR-DOMAIN.azurecomm.net" \
  DIGEST_EMAIL_RECIPIENT="your-email@example.com" \
  WEBSITE_TIME_ZONE="Central Standard Time"
```

| Variable | Description |
|---|---|
| `ACS_CONNECTION_STRING` | Connection string from ACS resource |
| `ACS_EMAIL_SENDER` | Sender address — must use a verified ACS domain |
| `DIGEST_EMAIL_RECIPIENT` | Where digest emails are delivered |
| `WEBSITE_TIME_ZONE` | Controls timer trigger timezone |

> **Tip:** Find your sender address in Azure Portal → Communication Services → Email → Provision Domains → look for the `MailFrom` address.

---

## Step 3: Test Digest

```bash
# Get function key
FUNC_KEY=$(az functionapp keys list -n YOUR-FUNC -g cerebro-rg --query "functionKeys.default" -o tsv)

# Trigger daily digest
curl "https://YOUR-FUNC.azurewebsites.net/api/daily-digest?code=$FUNC_KEY"

# Trigger weekly digest
curl "https://YOUR-FUNC.azurewebsites.net/api/weekly-digest?code=$FUNC_KEY"
```

Both endpoints return JSON with:

- `summary` — Markdown-formatted digest (for Teams)
- `summaryHtml` — HTML-formatted digest (for email)
- `thoughtCount` — Number of thoughts in the time window
- `completedCount` — Number of tasks completed

---

## Timer Schedule Reference

| Digest | CRON | Human-Readable | Timezone |
|--------|------|----------------|----------|
| Daily | `0 0 6 * * *` | 6:00 AM every day | Central Time |
| Weekly | `0 0 12 * * 0` | 12:00 PM every Sunday | Central Time |

Timezone is set via `WEBSITE_TIME_ZONE=Central Standard Time` on the function app. Azure Functions uses Windows timezone identifiers — `Central Standard Time` covers both CST and CDT (it auto-adjusts for daylight saving).

---

## Verification Gate

| # | Test | Expected |
|---|------|----------|
| 1 | Capture a few thoughts first | Thoughts in database |
| 2 | `curl .../api/daily-digest?code=KEY` | 200, JSON with summary |
| 3 | Check email inbox | Digest email received |
| 4 | Check Teams (if bot active) | Digest posted to conversation |

> **Important:** You must have at least one thought captured in the relevant time window (last 24h for daily, last 7 days for weekly) or the digest will report no activity.

---

## Customization

- **Change timezone:** Update `WEBSITE_TIME_ZONE` app setting
- **Change schedule:** Edit CRON expressions in `functions/cerebro-digest/index.ts`
- **Change email recipient:** Update `DIGEST_EMAIL_RECIPIENT` app setting
- **Disable email:** Remove `ACS_CONNECTION_STRING` (digest still posts to Teams)
- **Disable Teams:** No bot conversations registered (digest only sends email)

The digest function gracefully handles missing channels — if ACS is not configured, it skips email delivery and logs a warning. If no Teams conversations are registered, it skips proactive messaging.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Email not configured" warning | Missing ACS env vars | Set `ACS_CONNECTION_STRING` and `ACS_EMAIL_SENDER` |
| Email not received | Domain not verified | Check ACS domain verification status (DKIM, SPF, DMARC) in Azure Portal |
| Timer not firing | Timezone misconfigured | Verify `WEBSITE_TIME_ZONE` is set; check Application Insights logs |
| Empty digest | No thoughts in window | Capture some thoughts, then re-trigger manually |
| Digest truncated in Teams | Content exceeds ~24KB | Normal behavior — full content is in the email version |
| Email sends but Teams doesn't | No registered conversations | Have someone message the bot first to register a conversation |

> **Debugging tip:** Check Application Insights → Logs → `traces` table for digest function execution details. Filter by `cloud_RoleName == "YOUR-FUNC"` and look for digest-related log entries.

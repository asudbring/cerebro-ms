# Microsoft Teams Bot Setup

## Overview

The Cerebro Teams bot captures thoughts, manages tasks, and processes file attachments — all from a Teams chat. It uses the **Bot Framework** for authentication (JWT validation) and **auto-registers conversations** for proactive digest delivery.

> 💬 Send any message to capture a thought. Prefix with `done:`, `reopen:`, or `delete:` for task management.

**Key points:**
- Bot Framework handles auth (Entra ID JWT validation)
- File attachments are downloaded from SharePoint via Graph API
- Conversations are auto-registered for daily/weekly digest delivery
- Loop guard prevents the bot from processing its own replies

---

## Prerequisites

| Prerequisite | Why |
|---|---|
| Microsoft 365 account | Access to Teams |
| Teams admin access **OR** sideloading enabled | To install the app |
| Entra ID app registration | Bot identity (created by Terraform, or manually) |
| Azure Bot Service resource | Bot channel registration |
| Function app deployed | `cerebro-func` running on Azure |

---

## What the Bot Can Do

| Action | How | Example |
|--------|-----|---------|
| 📝 Capture thought | Send any message | "Remember to review the Q3 budget" |
| ✅ Mark task done | Prefix with `done:` | "done: review the Q3 budget" |
| 🔄 Reopen task | Prefix with `reopen:` | "reopen: review the Q3 budget" |
| 🗑️ Delete thought | Prefix with `delete:` | "delete: old meeting notes" |
| 📎 Attach files | Send image or DOCX | Images analyzed by gpt-4o vision |
| ⏰ Set reminder | Mention a date/time | "Call dentist on Tuesday at 2pm" |

---

## Step 1: Entra ID App Registration

> 💡 If you're using Terraform (`infra/`), the app registration is created automatically. Skip to [Step 3](#step-3-configure-function-app).

### Manual Registration

1. Go to **Azure Portal** → **Entra ID** → **App registrations** → **New registration**
2. Fill in:

| Field | Value |
|-------|-------|
| Name | `cerebro-teams-bot` |
| Supported account types | **Single tenant** |
| Redirect URI | _(leave blank)_ |

3. Click **Register**
4. Note the **Application (client) ID** — you'll need this as the Bot App ID
5. Go to **Certificates & Secrets** → **New client secret**
   - Description: `cerebro-bot-secret`
   - Expiry: 24 months (or your preference)
6. Copy the **secret value** immediately

> ⚠️ The secret value is only shown once. Store it securely.

### API Permissions (for file attachments)

If the bot needs to download file attachments from Teams (stored on SharePoint):

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph**
2. Select **Application permissions**
3. Add: `Sites.Read.All`
4. Click **Grant admin consent**

---

## Step 2: Create Azure Bot

### Using Azure CLI

```bash
# Create the bot resource
az bot create \
  --resource-group cerebro-rg \
  --name cerebro-bot \
  --app-type SingleTenant \
  --appid YOUR_BOT_APP_ID \
  --tenant-id YOUR_TENANT_ID \
  --endpoint "https://YOUR-FUNC.azurewebsites.net/cerebro-teams"

# Enable the Teams channel
az bot msteams create \
  --resource-group cerebro-rg \
  --name cerebro-bot
```

> 💡 Replace `YOUR_BOT_APP_ID`, `YOUR_TENANT_ID`, and `YOUR-FUNC` with your actual values.

### Using Azure Portal

1. Search for **"Azure Bot"** → **Create**
2. Fill in:

| Field | Value |
|-------|-------|
| Bot handle | `cerebro-bot` |
| Resource group | `cerebro-rg` |
| Type of app | Single Tenant |
| Microsoft App ID | _(paste your Entra app ID)_ |
| Messaging endpoint | `https://YOUR-FUNC.azurewebsites.net/cerebro-teams` |

3. After creation, go to **Channels** → **Microsoft Teams** → **Apply**

---

## Step 3: Configure Function App

### Core Bot Settings

```bash
az functionapp config appsettings set \
  -n YOUR-FUNC \
  -g cerebro-rg \
  --settings \
    TEAMS_BOT_APP_ID="your_bot_app_id" \
    TEAMS_BOT_APP_SECRET="your_bot_secret"
```

### File Attachment Support

For downloading files that users send to the bot (stored on SharePoint):

```bash
az functionapp config appsettings set \
  -n YOUR-FUNC \
  -g cerebro-rg \
  --settings \
    GRAPH_TENANT_ID="your_tenant_id" \
    GRAPH_CLIENT_ID="your_bot_app_id" \
    GRAPH_CLIENT_SECRET="your_bot_secret"
```

> 💡 The Graph API credentials can use the **same app registration** as the bot, provided it has `Sites.Read.All` permission.

### Local Development

Add to `functions/local.settings.json`:

```json
{
  "Values": {
    "TEAMS_BOT_APP_ID": "your_bot_app_id",
    "TEAMS_BOT_APP_SECRET": "your_bot_secret",
    "GRAPH_TENANT_ID": "your_tenant_id",
    "GRAPH_CLIENT_ID": "your_bot_app_id",
    "GRAPH_CLIENT_SECRET": "your_bot_secret"
  }
}
```

---

## Step 4: Create Teams App Package

The Teams app package is a ZIP file containing a manifest and icons.

### 4a. Add Icon Files

Place these in the `teams/` directory:

| File | Size | Description |
|------|------|-------------|
| `color.png` | 192 × 192 px | Full-color app icon |
| `outline.png` | 32 × 32 px | Transparent outline icon |

### 4b. Edit the Manifest

Edit `teams/manifest.json` and verify the `botId` matches your Entra app registration:

```json
{
  "bots": [
    {
      "botId": "YOUR_BOT_APP_ID",
      "scopes": ["personal", "team"],
      "supportsFiles": true
    }
  ]
}
```

### 4c. Create the ZIP Package

```powershell
Compress-Archive `
  -Path teams\manifest.json, teams\color.png, teams\outline.png `
  -DestinationPath teams\cerebro-teams.zip `
  -Force
```

Or on Linux/macOS:

```bash
cd teams && zip cerebro-teams.zip manifest.json color.png outline.png
```

---

## Step 5: Sideload the App

### Option A: Teams Admin Center 🏢

For organization-wide deployment:

1. Go to **https://admin.teams.microsoft.com**
2. Navigate to **Teams apps** → **Manage apps**
3. Click **⬆ Upload new app**
4. Select `teams/cerebro-teams.zip`
5. The app appears in the org's app catalog

### Option B: Teams Client (Personal) 👤

For individual use or testing:

1. Open **Microsoft Teams**
2. Go to **Apps** (left sidebar) → **Manage your apps**
3. Click **⬆ Upload a custom app**
4. Choose **Upload for me or my teams**
5. Select `teams/cerebro-teams.zip`

> 💡 Sideloading must be enabled by your Teams admin. If you see "Uploading custom apps is disabled," contact your admin.

---

## Step 6: Test the Bot

### 🧪 Basic Capture

1. Find **"Cerebro"** in Teams apps
2. Start a personal conversation with the bot
3. Send: `Testing the Cerebro bot — this is my first captured thought`
4. ✅ Bot should reply with:

```
**Captured:** Testing Cerebro bot (reflection) [cerebro, testing]
```

### 🧪 Task Management

5. Send: `done: testing the cerebro bot`
6. ✅ Bot should reply with:

```
✅ **Marked done:** Testing Cerebro bot (similarity: 0.92)
```

7. Send: `reopen: testing the cerebro bot`
8. ✅ Bot should reply with:

```
🔄 **Reopened:** Testing Cerebro bot
```

### 🧪 File Attachment

9. Send an image to the bot with a caption
10. ✅ Bot should analyze the image and capture the thought with file context

---

## Verification Gate

Run through this checklist to confirm the bot is working end-to-end:

| # | Test | Send | Expected Response |
|---|------|------|-------------------|
| 1 | Capture thought | Any message | `**Captured:** ... (type) [tags]` |
| 2 | Mark task done | `done: <description>` | `✅ **Marked done:** ...` |
| 3 | Reopen task | `reopen: <description>` | `🔄 **Reopened:** ...` |
| 4 | Delete thought | `delete: <description>` | `🗑️ **Deleted:** ...` |
| 5 | Image attachment | Send an image | Image analyzed, thought captured |
| 6 | DOCX attachment | Send a .docx file | Content extracted, thought captured |
| 7 | Reminder | "Call Bob on Friday at 3pm" | Thought captured with reminder info |
| 8 | Daily digest | _(triggered by schedule)_ | Bot posts summary to conversation |

---

## Troubleshooting

### ❌ Bot Not Responding

- **Check env vars:** Verify `TEAMS_BOT_APP_ID` and `TEAMS_BOT_APP_SECRET` are set correctly on the function app
- **Check endpoint:** The messaging endpoint must be `https://YOUR-FUNC.azurewebsites.net/cerebro-teams`
- **Check logs:**
  ```bash
  az functionapp log tail -n YOUR-FUNC -g cerebro-rg --filter "teams"
  ```

### 🔒 "Unauthorized" Errors

- Verify the Entra app registration **tenant** matches the bot resource tenant
- Ensure the app secret hasn't expired
- Check that the `botId` in `manifest.json` matches the Entra app ID

### 📎 File Attachments Failing

- Confirm `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, and `GRAPH_CLIENT_SECRET` are set
- Verify the app has `Sites.Read.All` **application** permission (not delegated)
- Ensure admin consent has been granted

### 🔄 Bot Replying to Itself (Loop)

The bot has a **loop guard** that rejects messages starting with known reply prefixes:

| Prefix | Meaning |
|--------|---------|
| `**Captured**` | Thought capture reply |
| `✅ **Marked done` | Task completion reply |
| `🔄 **Reopened` | Task reopen reply |
| `🗑️ **Deleted` | Thought deletion reply |

If the bot is looping, check that the loop guard logic in `ingest-thought/index.ts` is working correctly.

### ⏳ Cold Start Delays

The first message after a period of inactivity may take 30–60 seconds as the function app warms up. Subsequent messages are fast.

---

## Technical Details

### Supported File Types

| File Type | Processing |
|-----------|-----------|
| Images (PNG, JPG, GIF, etc.) | Analyzed by gpt-4o vision model |
| DOCX | Content extracted by mammoth library |
| PDF | Basic noting (full parsing not implemented) |
| Other | File noted but content not extracted |

### File Storage

- Files uploaded to Teams are stored on **SharePoint**
- The bot downloads files via **Microsoft Graph API** using client credentials
- Downloaded files are uploaded to **Azure Blob Storage** (`cerebro-files` container)
- SAS URLs (1-year expiry) are stored in the `file_url` column

### Digest Delivery

The bot **auto-registers** conversation references when users first message it. These references are used for proactive messaging:

- **Daily digest** — sent at scheduled time, covers last 24 hours + reminders due in 48h
- **Weekly digest** — sent at scheduled time, covers last 7 days + reminders due in 7 days

### Environment Variables Summary

| Variable | Required | Purpose |
|----------|----------|---------|
| `TEAMS_BOT_APP_ID` | ✅ | Bot Framework app ID |
| `TEAMS_BOT_APP_SECRET` | ✅ | Bot Framework app secret |
| `GRAPH_TENANT_ID` | 📎 | For file attachment downloads |
| `GRAPH_CLIENT_ID` | 📎 | For file attachment downloads |
| `GRAPH_CLIENT_SECRET` | 📎 | For file attachment downloads |

✅ = Required for bot to function | 📎 = Required for file attachment support

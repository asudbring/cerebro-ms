# Cerebro Teams App

Teams app manifest for the Cerebro personal knowledge base bot.

## Setup

### 1. Add Icons

Add two icon files to this directory:

- **color.png** — 192×192 px, full-color icon (used in the Teams app store and chat)
- **outline.png** — 32×32 px, transparent outline icon (used in the Teams app bar)

Both must be PNG format. The color icon should use the accent color `#4B0082` (indigo/purple).

### 2. Package the App

Zip the three files together into a single `.zip` archive:

```bash
# From the teams/ directory
zip cerebro-teams.zip manifest.json color.png outline.png
```

Or on Windows (PowerShell):

```powershell
Compress-Archive -Path manifest.json, color.png, outline.png -DestinationPath cerebro-teams.zip
```

### 3. Sideload in Teams

1. Open Microsoft Teams
2. Go to **Apps** (left sidebar)
3. Click **Manage your apps** (bottom-left)
4. Click **Upload a custom app** → **Upload a custom app for me or my teams**
5. Select the `cerebro-teams.zip` file
6. Click **Add** to install

### 4. Start Using Cerebro

The bot responds to messages in **personal chat**, **teams**, and **group chats**:

- **Capture a thought** — Send any message to the bot (e.g., "Remember to review the Q3 budget")
- **Mark a task done** — Prefix with `done:` (e.g., "done: review the Q3 budget")
- **Reopen a task** — Prefix with `reopen:` (e.g., "reopen: review the Q3 budget")
- **Delete a thought** — Prefix with `delete:` (e.g., "delete: old meeting notes")
- **Set a reminder** — Mention a date/time and it will be extracted automatically

## Azure Bot Registration

The bot is registered in your resource group:

- **App ID:** Your Entra ID app registration client ID
- **App Type:** SingleTenant
- **Messaging Endpoint:** `https://YOUR-FUNC.azurewebsites.net/cerebro-teams`
- **Channel:** Microsoft Teams

To recreate the bot registration:

```bash
az bot create --resource-group cerebro-rg --name YOUR-BOT-NAME \
  --app-type SingleTenant \
  --appid YOUR_BOT_APP_ID \
  --tenant-id YOUR_ENTRA_TENANT_ID \
  --endpoint "https://YOUR-FUNC.azurewebsites.net/cerebro-teams" \
  --tags project=cerebro

az bot msteams create --resource-group cerebro-rg --name YOUR-BOT-NAME
```

# Troubleshooting

## Capture Issues (Part 1)

### Power Automate flow fails on the HTTP action

Most common cause: the Azure Function is cold-starting or the request body is malformed. Check the flow run history in Power Automate for the exact error.

If the HTTP action returns a 400:
- Verify the body expressions use `body('Get_message_details')` — e.g., `body('Get_message_details')?['body']?['plainTextContent']`
- Look at the Compose action output to see the raw structure

If the HTTP action returns a 401:
- Verify the `?key=` parameter in the URI matches the `MCP_ACCESS_KEY` app setting

### Messages aren't being captured (no reply in Teams)

1. **Check flow trigger:** Make sure the flow uses "When a new channel message is added" pointed at your dedicated capture channel
2. **Check flow run history** at [make.powerautomate.com](https://make.powerautomate.com) — look for failed runs
3. **Check function logs:**
   ```bash
   az functionapp log tail --name open-brain-func --resource-group open-brain-rg
   ```

### Capture flow is looping (infinite replies)

The ingest function has a **loop guard** that rejects messages starting with `**Captured**`, `✅ **Marked done`, or `🔄 **Reopened**`. If you still see loops:

1. **Turn off the flow** immediately at [make.powerautomate.com](https://make.powerautomate.com)
2. Verify the flow uses **"Reply with a message"** (not "Post message") — replies don't trigger the "When a new channel message is added" trigger
3. Clean up duplicate entries in the database:
   ```sql
   DELETE FROM thoughts WHERE content LIKE '%**Captured**%' OR content LIKE '%Captured as%';
   ```

### Function runs but nothing in the database

Most likely the `DATABASE_URL` is wrong or the PostgreSQL firewall is blocking the connection.

- Verify the connection string in app settings:
  ```bash
  az functionapp config appsettings list --name open-brain-func --resource-group open-brain-rg
  ```
- Make sure you've allowed Azure services to connect:
  ```bash
  az postgres flexible-server firewall-rule create \
    --resource-group open-brain-rg \
    --name open-brain-db \
    --rule-name allow-azure \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0
  ```

### Reply shows up but metadata looks wrong

That's normal. The LLM is making its best guess with limited context. The metadata is a convenience layer — the embedding handles semantic search regardless of how metadata gets classified.

### Task completion didn't match the right task

The completion matching uses semantic similarity with a threshold of 0.3. If the description in your `done:` message is too vague, it may match the wrong task or fail to match at all. Be specific:
- ✅ `done: vnet troubleshooting documentation`
- ❌ `done: the docs`

### Reopen didn't find the task

Same as above — be specific in your description. The reopen search only looks at tasks with status `done`. If the task was never marked as done, reopen won't find it.

## Digest Issues

### Daily/weekly digest returns "skipped"

This means no thoughts were captured in the time period. The digest skips if there's nothing to summarize. Check your capture flow is working.

### Digest email has raw HTML tags

In the Power Automate "Send an email" action, click **Show advanced options** and toggle **Is HTML** to Yes. If the toggle isn't visible, the `summaryHtml` content should still render in most email clients since it contains HTML tags.

### Digest Teams message fails with RequestEntityTooLarge

Teams has a ~28KB message size limit. The digest function truncates the Teams-bound summary (`summary` field) when it exceeds 24KB — the AI summary is kept but the individual thought list is replaced with a note to check the email. The full content is always included in the `summaryHtml` field sent via email.

### Digest flow fails on the HTTP action

Verify the digest URL includes the access key: `?key=YOUR-ACCESS-KEY`. The digest endpoints use the same `MCP_ACCESS_KEY` authentication.

## Retrieval Issues (Part 2)

### Getting 401 from the MCP server

The access key doesn't match. Verify:
```bash
az functionapp config appsettings list \
  --name open-brain-func \
  --resource-group open-brain-rg \
  --query "[?name=='MCP_ACCESS_KEY'].value" -o tsv
```

Make sure the `?key=` value in your URL matches exactly. If using the header approach, the header must be `x-brain-key` (lowercase, with dash).

### Claude Desktop tools don't appear

- Make sure you added the connector in **Settings → Connectors** (not via JSON config file)
- Verify the connector is enabled for your conversation (click **+** → **Connectors**)
- Try removing and re-adding the connector

### ChatGPT doesn't use the Open Brain tools

- Confirm **Developer Mode** is enabled (Settings → Apps & Connectors → Advanced settings)
- Check the connector is active for the current conversation
- Be explicit: "Use the Open Brain search_thoughts tool to search for [topic]"

### Search returns no results

- Make sure you've captured some thoughts first (Part 1)
- Try a lower threshold: ask your AI to "search with threshold 0.3"
- Check the function logs for embedding errors

### First request is slow

Cold starts on the Azure Functions Consumption plan can take 10-20 seconds. Subsequent requests are fast. For consistently low latency, upgrade to the Premium plan or use an always-ready instance.

## Database Issues

### Can't connect with psql

- Check the firewall rules allow your IP:
  ```bash
  az postgres flexible-server firewall-rule list --resource-group open-brain-rg --name open-brain-db
  ```
- Make sure `sslmode=require` is in your connection string
- Verify the admin password is correct

### pgvector extension not available

Azure Database for PostgreSQL Flexible Server supports pgvector natively. If `CREATE EXTENSION vector` fails, check that your PostgreSQL version is 13+ and that you're running on Flexible Server (not Single Server, which is deprecated).

## Reminder Issues

### Reminder not creating a calendar event

- Verify the Parse JSON schema includes `has_reminder`, `reminder_title`, and `reminder_datetime` fields
- Check the Condition in Power Automate: `body('Parse_JSON')?['has_reminder']` is equal to `true`
- Confirm the "Create event (V4)" action has correct field mappings (Subject, Start time, End time)
- Check that the Office 365 Outlook connector is authorized for your account

### Reminder date/time is wrong

- The AI extracts dates relative to the current time (injected at runtime). Check if the function's timezone offset is correct (currently -06:00 Central Time)
- If only a date is given with no time, it defaults to 09:00
- Try being more explicit: "remind me Friday March 14 at 2:30pm" instead of "remind me next week"

### Reminders not showing in digests

- Reminders appear in digests based on the `reminder_datetime` stored in the thought's metadata JSONB column
- Daily digest shows reminders due in the next 48 hours; weekly shows the next 7 days
- Check that the thought was captured with `has_reminder: true` in its metadata:
  ```sql
  SELECT id, metadata->>'reminder_title', metadata->>'reminder_datetime' FROM thoughts WHERE metadata->>'has_reminder' = 'true';
  ```

## File Capture Issues

### File not being captured from Teams message

- Use `coalesce(body('Get_message_details')?['attachments'], json('[]'))` in the HTTP body (bare `null` breaks JSON)
- Teams file attachments have `contentType: "reference"` (not the actual MIME type) — the function resolves MIME from the file extension
- The function downloads files via Graph API using client credentials — verify `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` are set in function app settings
- The Entra ID app registration needs `Sites.Read.All` application permission with admin consent granted
- Check function logs for "Failed to get site" or "Failed to download file via Graph" messages

### 403 or 401 downloading SharePoint files

- Teams stores uploaded files on SharePoint — direct download requires auth
- The function uses an Entra ID app registration to get a Graph API token
- Verify admin consent was granted: check the app's "API permissions" in Entra ID portal — should show a green checkmark next to Sites.Read.All
- If the token has no roles, the service principal may not exist: run `az ad sp create --id <app-id>` then re-grant consent via `az rest --method POST` to the appRoleAssignments endpoint

### File uploaded but no AI analysis

- Check that `AZURE_OPENAI_VISION_DEPLOYMENT=gpt-4o` is set in the function app settings
- Verify the gpt-4o deployment exists in your Azure OpenAI account
- Image files larger than 20MB may fail — try resizing before posting

### File URL not accessible

- File URLs use SAS tokens with 1-year expiry — check if the token has expired
- Verify the `brain-files` container exists in `openbrainstorage`
- Check that `AZURE_STORAGE_CONNECTION_STRING` is set correctly in function app settings

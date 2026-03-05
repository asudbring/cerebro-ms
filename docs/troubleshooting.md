# Troubleshooting

## Capture Issues (Part 1)

### Power Automate flow fails on the HTTP action

Most common cause: the Azure Function is cold-starting or the request body is malformed. Check the flow run history in Power Automate for the exact error.

If the HTTP action returns a 400:
- Verify the body expressions use `first()` — the "Get message details" output is an **array**
- Check that `plainTextContent` path is correct: `first(outputs('Get_message_details'))?['body']?['body']?['plainTextContent']`
- Look at the Compose action output to see the raw structure

If the HTTP action returns a 401:
- Verify the `?key=` parameter in the URI matches the `MCP_ACCESS_KEY` app setting

### Messages aren't being captured (no reply in Teams)

1. **Check flow trigger:** Make sure the keyword (`brain`, `remember`) is in the message
2. **Check flow run history** at [make.powerautomate.com](https://make.powerautomate.com) — look for failed runs
3. **Check function logs:**
   ```bash
   az functionapp log tail --name open-brain-functions --resource-group open-brain-rg
   ```

### Function runs but nothing in the database

Most likely the `DATABASE_URL` is wrong or the PostgreSQL firewall is blocking the connection.

- Verify the connection string in app settings:
  ```bash
  az functionapp config appsettings list --name open-brain-functions --resource-group open-brain-rg
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
- ✅ `brain done: vnet troubleshooting documentation`
- ❌ `brain done: the docs`

### Reopen didn't find the task

Same as above — be specific in your description. The reopen search only looks at tasks with status `done`. If the task was never marked as done, reopen won't find it.

## Digest Issues

### Daily/weekly digest returns "skipped"

This means no thoughts were captured in the time period. The digest skips if there's nothing to summarize. Check your capture flow is working.

### Digest email has raw HTML tags

In the Power Automate "Send an email" action, click **Show advanced options** and toggle **Is HTML** to Yes. If the toggle isn't visible, the `summaryHtml` content should still render in most email clients since it contains HTML tags.

### Digest flow fails on the HTTP action

Verify the digest URL includes the access key: `?key=YOUR-ACCESS-KEY`. The digest endpoints use the same `MCP_ACCESS_KEY` authentication.

## Retrieval Issues (Part 2)

### Getting 401 from the MCP server

The access key doesn't match. Verify:
```bash
az functionapp config appsettings list \
  --name open-brain-functions \
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

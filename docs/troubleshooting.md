# Troubleshooting

## Capture Issues (Part 1)

### Teams says the webhook failed or timed out

The Azure Function may not be deployed or may be cold-starting. Azure Functions on the Consumption plan can take 10-20 seconds on first invocation after idle. Try sending another message — the second attempt should be faster.

If it consistently fails:
```bash
# Check if the function is deployed
func azure functionapp list-functions open-brain-functions

# Check the function logs
az functionapp log tail --name open-brain-functions --resource-group open-brain-rg
```

### Messages aren't being captured (no reply, no database row)

1. **Verify the webhook URL** matches your function URL exactly
2. **Check the HMAC secret** — if `TEAMS_WEBHOOK_SECRET` doesn't match the token Teams generated, requests get rejected with 401
3. **Check function logs** for errors:
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

### Duplicate captures

If the Azure Function takes longer than Teams' timeout (currently ~10 seconds), Teams may retry the webhook. The captures are identical, so it doesn't affect search. You can delete duplicates in the database if it bothers you.

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

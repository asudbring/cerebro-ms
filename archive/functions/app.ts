/**
 * Azure Functions v4 entry point.
 * Imports all function modules to register HTTP triggers.
 */
import "./ingest-thought/index.js";
import "./cerebro-mcp/index.js";
import "./digest/index.js";

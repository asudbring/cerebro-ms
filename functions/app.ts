/**
 * Azure Functions v4 entry point.
 * Imports all function modules to register HTTP triggers.
 */
import "./ingest-thought/index.js";
import "./open-brain-mcp/index.js";

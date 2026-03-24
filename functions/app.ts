// Azure Functions v4 entry point
// Each module self-registers its HTTP/Timer triggers via app.http() / app.timer()
import './cerebro-mcp/index.js';
import './cerebro-teams/index.js';
import './cerebro-digest/index.js';

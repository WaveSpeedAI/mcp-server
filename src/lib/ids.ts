// Ids that go into an API path, checked before the request is built: the same
// patterns as the remote MCP (api-server handler/mcp_tools.go mcpModelIDPattern
// and mcpPredictionIDPattern), so a stray "../" or "?" never reaches the URL.

export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,3}$/;
export const PREDICTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function checkModelId(id: string): string {
  if (!MODEL_ID_PATTERN.test(id)) throw new Error(`Invalid model id "${id}". Use an id returned by list_models.`);
  return id;
}

export function checkPredictionId(raw: string): string {
  const id = raw.trim();
  if (!PREDICTION_ID_PATTERN.test(id)) throw new Error(`Invalid prediction id "${raw}".`);
  return id;
}

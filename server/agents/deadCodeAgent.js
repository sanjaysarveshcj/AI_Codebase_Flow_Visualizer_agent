function isServerFile(filePath) {
  return /(^|[\\/])server([\\/]|$)/i.test(filePath || "");
}

function normalizeSymbol(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const lowered = value.toLowerCase().replaceAll("()", "").trim();
  if (!lowered || lowered === "anonymous" || lowered.startsWith("inline_handler")) {
    return null;
  }

  const tail = lowered.split(".").at(-1) || lowered;
  const sanitized = tail.replaceAll(/[^a-z0-9_$]/g, "");
  return sanitized || null;
}

function addSymbol(symbolSet, rawValue) {
  const normalized = normalizeSymbol(rawValue);
  if (normalized) {
    symbolSet.add(normalized);
  }
}

function collectUsedSymbols(parsed) {
  const usedSymbols = new Set();

  for (const invocation of parsed.functionInvocations || []) {
    addSymbol(usedSymbols, invocation.callee);
  }

  for (const route of parsed.expressRoutes || []) {
    addSymbol(usedSymbols, route.handler);

    for (const middleware of route.middlewares || []) {
      addSymbol(usedSymbols, middleware);
    }
  }

  for (const operation of parsed.mongooseOperations || []) {
    addSymbol(usedSymbols, operation.functionName);
  }

  return usedSymbols;
}

function routeKey(route) {
  return `${route.filePath}:${route.line || 0}:${route.method}:${route.path}`;
}

function apiCallKey(apiCall) {
  return `${apiCall.filePath}:${apiCall.line || 0}:${apiCall.method}:${apiCall.endpoint}`;
}

function modelAliases(name) {
  const modelName = (name || "").toLowerCase();
  if (!modelName) {
    return [];
  }

  const withoutSuffix = modelName.endsWith("model")
    ? modelName.slice(0, -"model".length)
    : modelName;

  return [...new Set([modelName, `${modelName}model`, withoutSuffix, `${withoutSuffix}model`])];
}

function findPotentiallyUnusedFunctions(parsed, usedSymbols) {
  return (parsed.functionDefinitions || [])
    .filter((definition) => isServerFile(definition.filePath))
    .filter((definition) => {
      const symbol = normalizeSymbol(definition.name);
      return symbol && !usedSymbols.has(symbol);
    })
    .map((definition) => ({
      name: definition.name,
      filePath: definition.filePath,
      line: definition.line,
      reason: "Not referenced by route handlers, middleware chains, or observed invocations",
    }));
}

function findUnlinkedRoutes(parsed, flows) {
  const linkedRouteKeys = new Set(
    (flows.items || []).map((flow) => routeKey(flow.backendRoute || {}))
  );

  return (parsed.expressRoutes || [])
    .filter((route) => isServerFile(route.filePath))
    .filter((route) => !linkedRouteKeys.has(routeKey(route)));
}

function findUnusedModels(parsed) {
  const usedModelAliases = new Set();

  for (const operation of parsed.mongooseOperations || []) {
    for (const alias of modelAliases(operation.model)) {
      usedModelAliases.add(alias);
    }
  }

  return (parsed.mongooseModels || [])
    .filter((model) => isServerFile(model.filePath))
    .filter((model) => {
      const aliases = modelAliases(model.model);
      return aliases.every((alias) => !usedModelAliases.has(alias));
    });
}

function findUnmatchedApiCalls(parsed, flows) {
  const matchedApiKeys = new Set(
    (flows.items || []).map((flow) => apiCallKey(flow.frontendAction || {}))
  );

  return (parsed.frontendApiCalls || []).filter(
    (apiCall) => !matchedApiKeys.has(apiCallKey(apiCall))
  );
}

function analyzeDeadCode(parsed, flows) {
  const usedSymbols = collectUsedSymbols(parsed);
  const potentiallyUnusedFunctions = findPotentiallyUnusedFunctions(parsed, usedSymbols);
  const unlinkedRoutes = findUnlinkedRoutes(parsed, flows);
  const unusedModels = findUnusedModels(parsed);
  const unmatchedApiCalls = findUnmatchedApiCalls(parsed, flows);

  return {
    summary: {
      potentiallyUnusedFunctions: potentiallyUnusedFunctions.length,
      unlinkedRoutes: unlinkedRoutes.length,
      unusedModels: unusedModels.length,
      unmatchedApiCalls: unmatchedApiCalls.length,
    },
    potentiallyUnusedFunctions,
    unlinkedRoutes,
    unusedModels,
    unmatchedApiCalls,
    caveat:
      "Dead code signals are heuristic and should be reviewed manually, especially for dynamic imports and externally consumed endpoints.",
  };
}

module.exports = {
  analyzeDeadCode,
};

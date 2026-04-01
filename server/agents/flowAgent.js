function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "string") {
    return null;
  }

  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    const protocolBoundary = endpoint.indexOf("://");
    const pathStartIndex = endpoint.indexOf("/", protocolBoundary + 3);

    if (pathStartIndex === -1) {
      return "/";
    }

    const pathWithQuery = endpoint.slice(pathStartIndex);
    const queryStartIndex = pathWithQuery.indexOf("?");
    return queryStartIndex === -1
      ? pathWithQuery
      : pathWithQuery.slice(0, queryStartIndex);
  }

  return endpoint;
}

function normalizeSymbol(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value
    .replaceAll(/\(\)$/g, "")
    .split(".")
    .at(-1)
    .toLowerCase();
}

function routeToRegex(routePath) {
  const pattern = routePath
    .replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll(/:[^/]+/g, "[^/]+");

  return new RegExp(`^${pattern}$`);
}

function methodsMatch(apiMethod, routeMethod) {
  if (!apiMethod || !routeMethod) {
    return false;
  }

  return routeMethod === "ALL" || routeMethod === "USE" || apiMethod === routeMethod;
}

function classifyRouteMatch(normalizedEndpoint, routePath) {
  if (!normalizedEndpoint || !routePath) {
    return "none";
  }

  return normalizedEndpoint === routePath ? "exact" : "dynamic";
}

function getRouteSpecificity(routePath) {
  const segments = (routePath || "").split("/").filter(Boolean);
  const staticCount = segments.filter((segment) => !segment.startsWith(":" )).length;
  const dynamicCount = segments.length - staticCount;
  const total = Math.max(1, segments.length);

  return {
    staticCount,
    dynamicCount,
    total,
    ratio: Number((staticCount / total).toFixed(2)),
  };
}

function findMatchingRoute(apiCall, expressRoutes) {
  const normalized = normalizeEndpoint(apiCall.endpoint);
  if (!normalized) {
    return null;
  }

  const candidates = expressRoutes
    .filter((route) => {
      if (!methodsMatch(apiCall.method, route.method)) {
        return false;
      }

      return routeToRegex(route.path).test(normalized);
    })
    .map((route) => ({
      route,
      matchType: classifyRouteMatch(normalized, route.path),
      staticSegments: (route.path.match(/\//g) || []).length,
      specificity: getRouteSpecificity(route.path),
    }));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftPriority = left.matchType === "exact" ? -1 : 1;
    const rightPriority = right.matchType === "exact" ? -1 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.specificity.ratio !== right.specificity.ratio) {
      return right.specificity.ratio - left.specificity.ratio;
    }

    return right.staticSegments - left.staticSegments;
  });

  return {
    normalizedEndpoint: normalized,
    route: candidates[0].route,
    matchType: candidates[0].matchType,
    specificity: candidates[0].specificity,
  };
}

function buildFunctionLookup(parsed) {
  const lookup = new Map();

  for (const definition of parsed.functionDefinitions || []) {
    const key = normalizeSymbol(definition.name);
    if (!key) {
      continue;
    }

    if (!lookup.has(key)) {
      lookup.set(key, []);
    }

    lookup.get(key).push(definition);
  }

  return lookup;
}

function buildInvocationGraph(parsed, functionLookup) {
  const graph = new Map();
  const internalSymbols = new Set(functionLookup.keys());

  for (const invocation of parsed.functionInvocations || []) {
    const caller = normalizeSymbol(invocation.callerFunction);
    const callee = normalizeSymbol(invocation.callee);

    if (!caller || !callee) {
      continue;
    }

    // Keep only internal function-to-function calls so utility/library calls do not pollute flow chains.
    if (!internalSymbols.has(caller) || !internalSymbols.has(callee)) {
      continue;
    }

    if (!graph.has(caller)) {
      graph.set(caller, new Set());
    }

    graph.get(caller).add(callee);
  }

  return graph;
}

function traceReachableFunctions(startSymbol, invocationGraph) {
  if (!startSymbol) {
    return {
      symbols: new Set(),
      traversal: [],
    };
  }

  const visited = new Set([startSymbol]);
  const parentBySymbol = new Map();
  const queue = [startSymbol];

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = invocationGraph.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      parentBySymbol.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  const traversal = [...parentBySymbol.entries()].map(([to, from]) => ({
    from,
    to,
  }));

  return {
    symbols: visited,
    traversal,
  };
}

function findControllerDefinition(route, functionLookup) {
  const handlerSymbol = normalizeSymbol(route.handler);
  if (!handlerSymbol) {
    return null;
  }

  const candidates = functionLookup.get(handlerSymbol) || [];
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftControllerScore = /controller/i.test(left.filePath) ? -1 : 1;
    const rightControllerScore = /controller/i.test(right.filePath) ? -1 : 1;

    if (leftControllerScore !== rightControllerScore) {
      return leftControllerScore - rightControllerScore;
    }

    return (left.line || Number.MAX_SAFE_INTEGER) - (right.line || Number.MAX_SAFE_INTEGER);
  });

  return sorted[0];
}

function findFunctionDefinition(symbol, functionLookup, preferredFilePath) {
  if (!symbol) {
    return null;
  }

  const candidates = functionLookup.get(symbol) || [];
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftPreferred = left.filePath === preferredFilePath ? -1 : 1;
    const rightPreferred = right.filePath === preferredFilePath ? -1 : 1;

    if (leftPreferred !== rightPreferred) {
      return leftPreferred - rightPreferred;
    }

    return (left.line || Number.MAX_SAFE_INTEGER) - (right.line || Number.MAX_SAFE_INTEGER);
  });

  return sorted[0];
}

function buildModelAliasSet(parsed) {
  const aliases = new Set();

  for (const model of parsed.mongooseModels || []) {
    if (!model.model) {
      continue;
    }

    const lowered = model.model.toLowerCase();
    aliases.add(lowered);
    aliases.add(`${lowered}model`);
  }

  return aliases;
}

function isModelOperation(operation, modelAliases) {
  const modelName = (operation.model || "").toLowerCase();
  if (!modelName) {
    return false;
  }

  if (modelAliases.has(modelName)) {
    return true;
  }

  return /model/i.test(modelName) || /^[A-Z]/.test(operation.model || "");
}

function findDatabaseOperations(parsed, modelAliases, reachableSymbols) {
  if (!reachableSymbols || reachableSymbols.size === 0) {
    return [];
  }

  return (parsed.mongooseOperations || []).filter((operation) => {
    if (!isModelOperation(operation, modelAliases)) {
      return false;
    }

    const operationFunction = normalizeSymbol(operation.functionName);
    return operationFunction && reachableSymbols.has(operationFunction);
  });
}

function buildFlowSteps(
  apiCall,
  route,
  middlewares,
  controllerDefinition,
  indirectFunctions,
  databaseOperations
) {
  const steps = [
    `Frontend calls ${apiCall.method} ${apiCall.endpoint}`,
    `Backend handles via ${route.method} ${route.path}`,
  ];

  for (const middleware of middlewares) {
    steps.push(`Middleware executes: ${middleware}`);
  }

  if (route.handler) {
    steps.push(`Controller executes: ${route.handler}`);
  }

  if (controllerDefinition) {
    steps.push(
      `Controller definition: ${controllerDefinition.filePath}:${controllerDefinition.line || 0}`
    );
  }

  for (const helper of indirectFunctions) {
    steps.push(`Helper executes: ${helper}`);
  }

  for (const operation of databaseOperations) {
    if (operation.functionName) {
      steps.push(
        `DB operation: ${operation.model}.${operation.operation}() in ${operation.functionName}()`
      );
      continue;
    }

    steps.push(`DB operation: ${operation.model}.${operation.operation}()`);
  }

  return steps;
}

function scoreFlowConfidence({
  routeMatchType,
  routeSpecificity,
  middlewares,
  controllerDefinition,
  controllerSymbol,
  tracedFunctions,
  tracedFunctionDefinitions,
  databaseOperations,
}) {
  const weights = {
    routeQuality: 0.35,
    middlewareEvidence: 0.1,
    controllerResolution: 0.2,
    helperTraceability: 0.15,
    databaseLinkage: 0.2,
  };

  function resolveRouteQuality() {
    if (routeMatchType === "exact") {
      return 1;
    }

    if (routeMatchType === "dynamic") {
      return Math.max(0.55, routeSpecificity?.ratio || 0.55);
    }

    return 0.25;
  }

  function resolveControllerResolution() {
    if (controllerDefinition) {
      return 1;
    }

    if (controllerSymbol) {
      return 0.55;
    }

    return 0.2;
  }

  const routeQuality = resolveRouteQuality();

  const middlewareEvidence =
    middlewares.length > 0 ? Math.min(1, 0.55 + middlewares.length * 0.2) : 0.55;

  const controllerResolution = resolveControllerResolution();

  const helperTraceability =
    tracedFunctions.length <= 1
      ? 0.65
      : Math.min(1, tracedFunctionDefinitions.length / tracedFunctions.length + 0.2);

  const databaseLinkage =
    databaseOperations.length > 0 ? Math.min(1, 0.7 + databaseOperations.length * 0.15) : 0.25;

  const evidence = {
    routeQuality,
    middlewareEvidence,
    controllerResolution,
    helperTraceability,
    databaseLinkage,
  };

  const scoreBreakdown = Object.keys(weights).map((signal) => ({
    signal,
    weight: weights[signal],
    evidence: Number(evidence[signal].toFixed(2)),
    contribution: Number((weights[signal] * evidence[signal]).toFixed(3)),
  }));

  const rawScore = scoreBreakdown.reduce((total, item) => total + item.contribution, 0);
  const clamped = Math.max(0, Math.min(1, rawScore));
  const reasons = [];

  if (routeMatchType === "exact") {
    reasons.push("API endpoint exactly matches backend route path (strong route signal).");
  }

  if (routeMatchType === "dynamic") {
    reasons.push(
      `API endpoint matches a parameterized backend route (static ratio ${routeSpecificity?.ratio || 0}).`
    );
  }

  if (middlewares.length > 0) {
    reasons.push(`Detected ${middlewares.length} middleware step(s) in route chain.`);
  }

  if (controllerDefinition) {
    reasons.push("Controller function definition was resolved.");
  }

  if (!controllerDefinition && controllerSymbol) {
    reasons.push("Controller symbol was inferred but source definition could not be resolved.");
  }

  if (tracedFunctions.length > 1) {
    reasons.push(
      `Internal helper-function call chain was traced across ${tracedFunctions.length - 1} helper node(s).`
    );
  }

  if (tracedFunctionDefinitions.length > 0) {
    reasons.push(
      `Mapped ${tracedFunctionDefinitions.length}/${Math.max(
        tracedFunctions.length,
        1
      )} traced function symbol(s) to source definitions.`
    );
  }

  if (databaseOperations.length > 0) {
    reasons.push(`Linked ${databaseOperations.length} database operation(s) to reachable functions.`);
  }

  if (databaseOperations.length === 0) {
    reasons.push("No reachable database operation was linked for this flow.");
  }

  const level = resolveConfidenceLevel(clamped);

  return {
    score: Number(clamped.toFixed(2)),
    level,
    reasons,
    calibration: {
      routeMatchType,
      routeSpecificity: routeSpecificity || null,
      scoreBreakdown,
    },
  };
}

function buildExecutionPath(flow) {
  const path = [
    {
      type: "frontend_api",
      label: `${flow.frontendAction.method} ${flow.frontendAction.endpoint}`,
      filePath: flow.frontendAction.filePath,
      line: flow.frontendAction.line,
    },
    {
      type: "backend_route",
      label: `${flow.backendRoute.method} ${flow.backendRoute.path}`,
      filePath: flow.backendRoute.filePath,
      line: flow.backendRoute.line,
    },
  ];

  for (const middleware of flow.middlewareChain || []) {
    path.push({
      type: "middleware",
      label: middleware,
      filePath: flow.backendRoute.filePath,
      line: flow.backendRoute.line,
    });
  }

  path.push({
    type: "controller",
    label: flow.controllerHandler || flow.backendRoute.handler || "controller",
    filePath: flow.controllerDefinition?.filePath || flow.backendRoute.filePath,
    line: flow.controllerDefinition?.line || flow.backendRoute.line,
  });

  for (const helper of flow.indirectFunctions || []) {
    const definition = (flow.tracedFunctionDefinitions || []).find(
      (item) => item.symbol === helper
    );

    path.push({
      type: "function",
      label: definition?.name || helper,
      filePath: definition?.filePath || flow.controllerDefinition?.filePath || flow.backendRoute.filePath,
      line: definition?.line || flow.controllerDefinition?.line || flow.backendRoute.line,
    });
  }

  for (const operation of flow.databaseOperations || []) {
    path.push({
      type: "db_operation",
      label: `${operation.model}.${operation.operation}()`,
      filePath: operation.filePath,
      line: operation.line,
    });
  }

  return path;
}

function buildFlowNarrative(executionPath) {
  return executionPath.map((step) => step.label).join(" -> ");
}

function resolveConfidenceLevel(score) {
  if (score >= 0.78) {
    return "high";
  }

  if (score >= 0.56) {
    return "medium";
  }

  return "low";
}

function buildExecutionFlows(parsed) {
  const flows = [];
  const functionLookup = buildFunctionLookup(parsed);
  const invocationGraph = buildInvocationGraph(parsed, functionLookup);
  const modelAliases = buildModelAliasSet(parsed);

  for (const apiCall of parsed.frontendApiCalls) {
    const routeMatch = findMatchingRoute(apiCall, parsed.expressRoutes);

    if (!routeMatch) {
      continue;
    }

    const { route, matchType, specificity } = routeMatch;

    const middlewares = route.middlewares || [];
    const controllerDefinition = findControllerDefinition(route, functionLookup);
    const controllerSymbol = normalizeSymbol(route.handler);
    const traced = traceReachableFunctions(controllerSymbol, invocationGraph);

    if (controllerSymbol && !traced.symbols.has(controllerSymbol)) {
      traced.symbols.add(controllerSymbol);
    }

    const tracedFunctions = [...traced.symbols];
    const indirectFunctions = tracedFunctions.filter((symbol) => symbol !== controllerSymbol);
    const tracedFunctionDefinitions = tracedFunctions
      .map((symbol) => {
        const definition = findFunctionDefinition(
          symbol,
          functionLookup,
          controllerDefinition?.filePath
        );

        if (!definition) {
          return null;
        }

        return {
          symbol,
          name: definition.name,
          filePath: definition.filePath,
          line: definition.line,
        };
      })
      .filter(Boolean);

    const databaseOperations = findDatabaseOperations(parsed, modelAliases, traced.symbols);

    const flow = {
      id: `${apiCall.filePath}:${apiCall.line}->${route.filePath}:${route.line}`,
      frontendAction: apiCall,
      backendRoute: route,
      routeMatchType: matchType,
      routeSpecificity: specificity,
      middlewareChain: middlewares,
      controllerSymbol,
      controllerHandler: route.handler,
      controllerDefinition,
      tracedFunctions,
      indirectFunctions,
      tracedFunctionDefinitions,
      functionTraversal: traced.traversal,
      databaseOperations,
      steps: buildFlowSteps(
        apiCall,
        route,
        middlewares,
        controllerDefinition,
        indirectFunctions,
        databaseOperations
      ),
    };

    flow.executionPath = buildExecutionPath(flow);
    flow.narrative = buildFlowNarrative(flow.executionPath);
    flow.confidence = scoreFlowConfidence({
      routeMatchType: flow.routeMatchType,
      routeSpecificity: flow.routeSpecificity,
      middlewares,
      controllerDefinition,
      controllerSymbol,
      tracedFunctions,
      tracedFunctionDefinitions,
      databaseOperations,
    });

    flows.push(flow);
  }

  return {
    count: flows.length,
    items: flows,
  };
}

module.exports = {
  buildExecutionFlows,
};

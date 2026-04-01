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

function findDatabaseOperations(route, parsed, modelAliases) {
  const handlerSymbol = normalizeSymbol(route.handler);
  if (!handlerSymbol) {
    return [];
  }

  return (parsed.mongooseOperations || []).filter((operation) => {
    if (!isModelOperation(operation, modelAliases)) {
      return false;
    }

    return normalizeSymbol(operation.functionName) === handlerSymbol;
  });
}

function buildFlowSteps(apiCall, route, middlewares, controllerDefinition, databaseOperations) {
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

  for (const operation of databaseOperations) {
    steps.push(`DB operation: ${operation.model}.${operation.operation}()`);
  }

  return steps;
}

function buildExecutionFlows(parsed) {
  const flows = [];
  const functionLookup = buildFunctionLookup(parsed);
  const modelAliases = buildModelAliasSet(parsed);

  for (const apiCall of parsed.frontendApiCalls) {
    const normalized = normalizeEndpoint(apiCall.endpoint);

    const route = parsed.expressRoutes.find((candidate) => {
      if (!methodsMatch(apiCall.method, candidate.method)) {
        return false;
      }

      return routeToRegex(candidate.path).test(normalized);
    });

    if (!route) {
      continue;
    }

    const middlewares = route.middlewares || [];
    const controllerDefinition = findControllerDefinition(route, functionLookup);
    const databaseOperations = findDatabaseOperations(route, parsed, modelAliases);

    flows.push({
      id: `${apiCall.filePath}:${apiCall.line}->${route.filePath}:${route.line}`,
      frontendAction: apiCall,
      backendRoute: route,
      middlewareChain: middlewares,
      controllerHandler: route.handler,
      controllerDefinition,
      databaseOperations,
      steps: buildFlowSteps(
        apiCall,
        route,
        middlewares,
        controllerDefinition,
        databaseOperations
      ),
    });
  }

  return {
    count: flows.length,
    items: flows,
  };
}

module.exports = {
  buildExecutionFlows,
};

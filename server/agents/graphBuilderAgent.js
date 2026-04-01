function toNodeId(prefix, filePath, line) {
  return `${prefix}:${filePath}:${line || 0}`;
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

function ensureNode(nodes, seenNodes, node) {
  if (seenNodes.has(node.id)) {
    return;
  }

  seenNodes.add(node.id);
  nodes.push(node);
}

function ensureEdge(edges, seenEdges, edge) {
  if (seenEdges.has(edge.id)) {
    return;
  }

  seenEdges.add(edge.id);
  edges.push(edge);
}

function buildGraph(parsed, flows) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();
  const modelNodeByName = new Map();

  for (const apiCall of parsed.frontendApiCalls) {
    const id = toNodeId("api", apiCall.filePath, apiCall.line);
    ensureNode(nodes, seenNodes, {
      id,
      label: `${apiCall.method} ${apiCall.endpoint}`,
      type: "api_call",
      meta: apiCall,
    });
  }

  for (const route of parsed.expressRoutes) {
    const id = toNodeId("route", route.filePath, route.line);
    ensureNode(nodes, seenNodes, {
      id,
      label: `${route.method} ${route.path}`,
      type: "express_route",
      meta: route,
    });
  }

  for (const model of parsed.mongooseModels) {
    const id = toNodeId("model", model.filePath, model.line);
    modelNodeByName.set(model.model?.toLowerCase(), id);
    modelNodeByName.set(`${model.model?.toLowerCase()}model`, id);

    ensureNode(nodes, seenNodes, {
      id,
      label: model.model,
      type: "mongoose_model",
      meta: model,
    });
  }

  for (const flow of flows.items) {
    const sourceId = toNodeId("api", flow.frontendAction.filePath, flow.frontendAction.line);
    const targetId = toNodeId("route", flow.backendRoute.filePath, flow.backendRoute.line);

    ensureEdge(edges, seenEdges, {
      id: `edge:${sourceId}->${targetId}`,
      source: sourceId,
      target: targetId,
      label: "calls",
      meta: {
        flowId: flow.id,
      },
    });

    let previousNodeId = targetId;

    (flow.middlewareChain || []).forEach((middleware, index) => {
      const middlewareId = `middleware:${flow.backendRoute.filePath}:${flow.backendRoute.line || 0}:${index}`;

      ensureNode(nodes, seenNodes, {
        id: middlewareId,
        label: middleware,
        type: "middleware",
        meta: {
          middleware,
          filePath: flow.backendRoute.filePath,
          line: flow.backendRoute.line,
          routePath: flow.backendRoute.path,
        },
      });

      ensureEdge(edges, seenEdges, {
        id: `edge:${previousNodeId}->${middlewareId}`,
        source: previousNodeId,
        target: middlewareId,
        label: "middleware",
        meta: {
          flowId: flow.id,
        },
      });

      previousNodeId = middlewareId;
    });

    const controllerFilePath = flow.controllerDefinition?.filePath || flow.backendRoute.filePath;
    const controllerLine = flow.controllerDefinition?.line || flow.backendRoute.line;
    const controllerId = toNodeId("controller", controllerFilePath, controllerLine);

    ensureNode(nodes, seenNodes, {
      id: controllerId,
      label: flow.controllerHandler || flow.backendRoute.handler || "controller",
      type: "controller",
      meta: {
        handler: flow.controllerHandler,
        definition: flow.controllerDefinition,
      },
    });

    ensureEdge(edges, seenEdges, {
      id: `edge:${previousNodeId}->${controllerId}:${flow.id}`,
      source: previousNodeId,
      target: controllerId,
      label: "handles",
      meta: {
        flowId: flow.id,
      },
    });

    const definitionBySymbol = new Map(
      (flow.tracedFunctionDefinitions || []).map((definition) => [definition.symbol, definition])
    );
    const functionNodeBySymbol = new Map();

    function ensureFunctionNodeForSymbol(symbol) {
      if (!symbol) {
        return null;
      }

      if (symbol === flow.controllerSymbol) {
        return controllerId;
      }

      if (functionNodeBySymbol.has(symbol)) {
        return functionNodeBySymbol.get(symbol);
      }

      const definition = definitionBySymbol.get(symbol);
      const functionNodeId = definition
        ? toNodeId("function", definition.filePath, definition.line)
        : `function:${symbol}:${flow.id}`;

      ensureNode(nodes, seenNodes, {
        id: functionNodeId,
        label: definition?.name || symbol,
        type: "function",
        meta: {
          symbol,
          definition,
          flowId: flow.id,
        },
      });

      functionNodeBySymbol.set(symbol, functionNodeId);
      return functionNodeId;
    }

    for (const relation of flow.functionTraversal || []) {
      const sourceId = ensureFunctionNodeForSymbol(relation.from);
      const targetId = ensureFunctionNodeForSymbol(relation.to);

      if (!sourceId || !targetId || sourceId === targetId) {
        continue;
      }

      ensureEdge(edges, seenEdges, {
        id: `edge:${sourceId}->${targetId}:${flow.id}:fncall`,
        source: sourceId,
        target: targetId,
        label: "calls",
        meta: {
          flowId: flow.id,
        },
      });
    }

    for (const operation of flow.databaseOperations || []) {
      const operationId = toNodeId("dbop", operation.filePath, operation.line);
      const operationOwner = normalizeSymbol(operation.functionName);
      const operationSourceId =
        ensureFunctionNodeForSymbol(operationOwner) || controllerId;

      ensureNode(nodes, seenNodes, {
        id: operationId,
        label: `${operation.model}.${operation.operation}()`,
        type: "db_operation",
        meta: operation,
      });

      ensureEdge(edges, seenEdges, {
        id: `edge:${operationSourceId}->${operationId}:${flow.id}`,
        source: operationSourceId,
        target: operationId,
        label: "queries",
        meta: {
          flowId: flow.id,
        },
      });

      const modelNodeId = modelNodeByName.get((operation.model || "").toLowerCase());
      if (modelNodeId) {
        ensureEdge(edges, seenEdges, {
          id: `edge:${operationId}->${modelNodeId}`,
          source: operationId,
          target: modelNodeId,
          label: "uses_model",
          meta: {
            flowId: flow.id,
          },
        });
      }
    }
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };
}

module.exports = {
  buildGraph,
};

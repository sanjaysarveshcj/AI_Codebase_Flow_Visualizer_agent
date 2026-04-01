const fs = require("node:fs");
const path = require("node:path");
const { globSync } = require("glob");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const VALID_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);
const MONGOOSE_OPERATION_METHODS = new Set([
  "find",
  "findOne",
  "findById",
  "findByIdAndUpdate",
  "findOneAndUpdate",
  "findByIdAndDelete",
  "findOneAndDelete",
  "create",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "aggregate",
  "countDocuments",
  "save",
]);

function parseToAst(code) {
  return parser.parse(code, {
    sourceType: "unambiguous",
    plugins: [
      "jsx",
      "typescript",
      "classProperties",
      "classPrivateProperties",
      "objectRestSpread",
      "dynamicImport",
      "optionalChaining",
      "nullishCoalescingOperator",
      "decorators-legacy",
    ],
  });
}

function getCallName(node) {
  if (!node) return "unknown";
  if (node.type === "Identifier") return node.name;
  if (node.type === "CallExpression") {
    return `${getCallName(node.callee)}()`;
  }
  if (node.type === "MemberExpression") {
    const obj = getCallName(node.object);
    const prop = node.property?.name || "unknown";
    return `${obj}.${prop}`;
  }
  return "unknown";
}

function getEnclosingFunctionName(pathNode) {
  const functionPath = pathNode.getFunctionParent();
  if (!functionPath) {
    return null;
  }

  const fnNode = functionPath.node;

  if (fnNode.type === "FunctionDeclaration" && fnNode.id?.name) {
    return fnNode.id.name;
  }

  if (fnNode.type === "FunctionExpression" || fnNode.type === "ArrowFunctionExpression") {
    const parentNode = functionPath.parentPath?.node;

    if (parentNode?.type === "VariableDeclarator" && parentNode.id?.type === "Identifier") {
      return parentNode.id.name;
    }

    if (parentNode?.type === "ObjectProperty") {
      if (parentNode.key?.type === "Identifier") {
        return parentNode.key.name;
      }

      if (parentNode.key?.type === "StringLiteral") {
        return parentNode.key.value;
      }
    }

    return "anonymous";
  }

  return null;
}

function describeRouteHandler(node) {
  if (!node) {
    return "unknown";
  }

  if (node.type === "Identifier" || node.type === "MemberExpression") {
    return getCallName(node);
  }

  if (node.type === "CallExpression") {
    return `${getCallName(node.callee)}()`;
  }

  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    const line = node.loc?.start?.line || "unknown";
    return `inline_handler:${line}`;
  }

  return "unknown";
}

function getStringArg(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked || null;
  }
  return null;
}

function safeRelative(targetPath, absoluteFilePath) {
  const relative = path.relative(targetPath, absoluteFilePath);
  return relative || path.basename(absoluteFilePath);
}

function extractFrontendApiCalls(ast, targetPath, filePath) {
  const calls = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const callNode = pathNode.node;
      const callee = callNode.callee;
      const line = callNode.loc?.start?.line || null;

      if (callee?.type === "MemberExpression") {
        const objectName = callee.object?.name;
        const methodName = callee.property?.name;

        if (objectName === "axios" && HTTP_METHODS.has(methodName)) {
          calls.push({
            type: "api_call",
            client: "axios",
            method: methodName.toUpperCase(),
            endpoint: getStringArg(callNode.arguments[0]),
            filePath: safeRelative(targetPath, filePath),
            functionName: getCallName(callee),
            line,
          });
        }
      }

      if (callee?.type === "Identifier" && callee.name === "fetch") {
        const endpoint = getStringArg(callNode.arguments[0]);
        calls.push({
          type: "api_call",
          client: "fetch",
          method: "GET",
          endpoint,
          filePath: safeRelative(targetPath, filePath),
          functionName: "fetch",
          line,
        });
      }
    },
  });

  return calls.filter((call) => Boolean(call.endpoint));
}

function extractExpressRoutes(ast, targetPath, filePath) {
  const routes = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const callNode = pathNode.node;
      const callee = callNode.callee;

      if (callee?.type !== "MemberExpression") {
        return;
      }

      const receiverName = callee.object?.name;
      const methodName = callee.property?.name;

      if (!["router", "app"].includes(receiverName) || !HTTP_METHODS.has(methodName)) {
        return;
      }

      const routePath = getStringArg(callNode.arguments[0]);
      if (!routePath) {
        return;
      }

      const handlerNodes = callNode.arguments.slice(1);
      if (handlerNodes.length === 0) {
        return;
      }

      const handlerChain = handlerNodes.map((handlerNode) => describeRouteHandler(handlerNode));
      const middlewares = handlerChain.slice(0, -1);
      const handler = handlerChain.at(-1) || "unknown";

      routes.push({
        type: "express_route",
        layer: receiverName,
        method: methodName.toUpperCase(),
        path: routePath,
        handler,
        handlerChain,
        middlewares,
        filePath: safeRelative(targetPath, filePath),
        line: callNode.loc?.start?.line || null,
      });
    },
  });

  return routes;
}

function extractReactRoutes(ast, targetPath, filePath) {
  const routes = [];

  traverse(ast, {
    JSXOpeningElement(pathNode) {
      const node = pathNode.node;
      const name = node.name?.name;
      if (name !== "Route") {
        return;
      }

      const pathAttr = node.attributes.find((attr) => attr?.name?.name === "path");
      const elementAttr = node.attributes.find((attr) => attr?.name?.name === "element");

      const routePath = getStringArg(pathAttr?.value);
      const elementName =
        elementAttr?.value?.expression?.type === "JSXElement"
          ? elementAttr.value.expression.openingElement.name?.name
          : null;

      routes.push({
        type: "react_route",
        path: routePath,
        component: elementName,
        filePath: safeRelative(targetPath, filePath),
        line: node.loc?.start?.line || null,
      });
    },
  });

  return routes;
}

function extractMongooseModels(ast, targetPath, filePath) {
  const models = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const callNode = pathNode.node;
      const callee = callNode.callee;

      if (
        callee?.type === "MemberExpression" &&
        callee.object?.name === "mongoose" &&
        callee.property?.name === "model"
      ) {
        const modelName = getStringArg(callNode.arguments[0]);

        if (modelName) {
          models.push({
            type: "mongoose_model",
            model: modelName,
            filePath: safeRelative(targetPath, filePath),
            line: callNode.loc?.start?.line || null,
          });
        }
      }
    },
  });

  return models;
}

function extractFunctionDefinitions(ast, targetPath, filePath) {
  const definitions = [];
  const seen = new Set();

  function pushDefinition(name, line) {
    if (!name) {
      return;
    }

    const key = `${name}:${line || 0}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    definitions.push({
      type: "function_definition",
      name,
      filePath: safeRelative(targetPath, filePath),
      line: line || null,
    });
  }

  traverse(ast, {
    FunctionDeclaration(pathNode) {
      const parentType = pathNode.parentPath?.node?.type;
      const isTopLevel = parentType === "Program" || parentType === "ExportNamedDeclaration";

      if (!isTopLevel) {
        return;
      }

      pushDefinition(pathNode.node.id?.name, pathNode.node.loc?.start?.line);
    },
    VariableDeclarator(pathNode) {
      const node = pathNode.node;
      const isFunctionLike =
        node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression";
      const isTopLevel = pathNode.scope?.block?.type === "Program";

      if (isTopLevel && isFunctionLike && node.id?.type === "Identifier") {
        pushDefinition(node.id.name, node.loc?.start?.line);
      }
    },
  });

  return definitions;
}

function extractFunctionInvocations(ast, targetPath, filePath) {
  const invocations = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const callNode = pathNode.node;
      const calleeName = getCallName(callNode.callee);

      if (!calleeName || calleeName === "unknown") {
        return;
      }

      const callerFunction = getEnclosingFunctionName(pathNode);

      invocations.push({
        type: "function_invocation",
        callee: calleeName,
        callerFunction,
        filePath: safeRelative(targetPath, filePath),
        line: callNode.loc?.start?.line || null,
      });
    },
  });

  return invocations;
}

function extractMongooseOperations(ast, targetPath, filePath) {
  const operations = [];

  traverse(ast, {
    CallExpression(pathNode) {
      const callNode = pathNode.node;
      const callee = callNode.callee;

      if (callee?.type !== "MemberExpression") {
        return;
      }

      const operation = callee.property?.name;
      if (!MONGOOSE_OPERATION_METHODS.has(operation)) {
        return;
      }

      const modelRef = getCallName(callee.object);
      if (!modelRef || modelRef === "unknown") {
        return;
      }

      const modelName = modelRef.split(".").at(-1);
      if (!modelName) {
        return;
      }

      operations.push({
        type: "mongoose_operation",
        model: modelName,
        operation,
        filePath: safeRelative(targetPath, filePath),
        line: callNode.loc?.start?.line || null,
        functionName: getEnclosingFunctionName(pathNode),
      });
    },
  });

  return operations;
}

function parseFile(targetPath, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!VALID_EXTENSIONS.has(extension)) {
    return null;
  }

  const source = fs.readFileSync(filePath, "utf8");
  const ast = parseToAst(source);

  return {
    frontendApiCalls: extractFrontendApiCalls(ast, targetPath, filePath),
    expressRoutes: extractExpressRoutes(ast, targetPath, filePath),
    reactRoutes: extractReactRoutes(ast, targetPath, filePath),
    mongooseModels: extractMongooseModels(ast, targetPath, filePath),
    mongooseOperations: extractMongooseOperations(ast, targetPath, filePath),
    functionDefinitions: extractFunctionDefinitions(ast, targetPath, filePath),
    functionInvocations: extractFunctionInvocations(ast, targetPath, filePath),
  };
}

function parseCodebase(targetPath) {
  const files = globSync("**/*.{js,jsx,ts,tsx,mjs,cjs}", {
    cwd: targetPath,
    absolute: true,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.git/**",
    ],
  });

  const summary = {
    filesScanned: files.length,
    frontendApiCalls: [],
    expressRoutes: [],
    reactRoutes: [],
    mongooseModels: [],
    mongooseOperations: [],
    functionDefinitions: [],
    functionInvocations: [],
    errors: [],
  };

  for (const filePath of files) {
    try {
      const parsed = parseFile(targetPath, filePath);
      if (!parsed) continue;

      summary.frontendApiCalls.push(...parsed.frontendApiCalls);
      summary.expressRoutes.push(...parsed.expressRoutes);
      summary.reactRoutes.push(...parsed.reactRoutes);
      summary.mongooseModels.push(...parsed.mongooseModels);
      summary.mongooseOperations.push(...parsed.mongooseOperations);
      summary.functionDefinitions.push(...parsed.functionDefinitions);
      summary.functionInvocations.push(...parsed.functionInvocations);
    } catch (error) {
      summary.errors.push({
        filePath: safeRelative(targetPath, filePath),
        message: error.message,
      });
    }
  }

  return summary;
}

module.exports = {
  parseCodebase,
};

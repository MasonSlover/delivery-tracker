import type * as winston from "winston";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  ApolloServerErrorCode,
  unwrapResolverError,
} from "@apollo/server/errors";
import { typeDefs, resolvers, type AppContext } from "@delivery-tracker/api";
import {
  DefaultCarrierRegistry,
  logger as coreLogger,
} from "@delivery-tracker/core";
import { initLogger } from "./logger";
import type { StandaloneServerContextFunctionArgument } from '@apollo/server/dist/esm/standalone';
import * as http from 'http';

const serverRootLogger: winston.Logger = coreLogger.rootLogger.child({
  module: "server",
});

serverRootLogger.info("Starting server initialization");

// Create a separate HTTP server for health checks
const healthServer = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    serverRootLogger.debug("Health check request received");
  } else {
    res.writeHead(404);
    res.end();
  }
});

const port = Number(process.env.PORT) || 4000;
healthServer.listen(port, '0.0.0.0', () => {
  serverRootLogger.info(`Health check server listening on port ${port}`);
});

const server = new ApolloServer<{ appContext: AppContext }>({
  typeDefs,
  resolvers: resolvers.resolvers,
  formatError: (formattedError: any, error: unknown) => {
    const extensions = formattedError.extensions ?? {};
    switch (extensions.code) {
      case "INTERNAL":
      case "BAD_REQUEST":
      case "NOT_FOUND":
      case ApolloServerErrorCode.INTERNAL_SERVER_ERROR:
        extensions.code = "INTERNAL";
        break;
      case ApolloServerErrorCode.GRAPHQL_PARSE_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_FOUND:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_SUPPORTED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.BAD_USER_INPUT:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.OPERATION_RESOLUTION_FAILURE:
        extensions.code = "BAD_REQUEST";
        break;
      default:
        extensions.code = "INTERNAL";
        break;
    }

    if (extensions.code === "INTERNAL") {
      serverRootLogger.error("internal error response", {
        formattedError,
        error: unwrapResolverError(error),
      });
    }

    return {
      ...formattedError,
      extensions,
      message:
        extensions.code === "INTERNAL"
          ? "Internal error"
          : formattedError.message,
    };
  },
});

async function main(): Promise<void> {
  try {
    serverRootLogger.info("Initializing carrier registry");
    const carrierRegistry = new DefaultCarrierRegistry();
    await carrierRegistry.init();
    serverRootLogger.info("Carrier registry initialized successfully");

    const appContext: AppContext = {
      carrierRegistry,
    };

    serverRootLogger.info(`Attempting to start Apollo Server on port ${port + 1}`);

    const { url } = await startStandaloneServer(server, {
      context: async (contextArg: StandaloneServerContextFunctionArgument) => {
        serverRootLogger.debug("Processing GraphQL request", { headers: contextArg.req.headers });
        return { appContext };
      },
      listen: { port: port + 1, host: '0.0.0.0' }
    });
    
    serverRootLogger.info(`🚀 GraphQL Server ready at ${url}`);
  } catch (err) {
    serverRootLogger.error("Failed to start server", { error: err });
    throw err;
  }
}

process.on('unhandledRejection', (reason, promise) => {
  serverRootLogger.error('Unhandled Rejection at:', {
    promise,
    reason,
  });
});

process.on('uncaughtException', (error) => {
  serverRootLogger.error('Uncaught Exception:', {
    error,
  });
});

initLogger();
serverRootLogger.info("Logger initialized");

main().catch((err) => {
  serverRootLogger.error("Uncaught error in main", {
    error: err,
  });
  process.exit(1);
});

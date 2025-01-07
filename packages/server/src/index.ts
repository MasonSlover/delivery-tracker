import 'source-map-support/register';
import type * as winston from "winston";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs, resolvers, type AppContext } from "@delivery-tracker/api";
import {
  DefaultCarrierRegistry,
  logger as coreLogger,
} from "@delivery-tracker/core";
import { initLogger } from "./logger";
import express from 'express';
import http from 'http';
import cors from 'cors';

const serverRootLogger: winston.Logger = coreLogger.rootLogger.child({
  module: "server",
});

serverRootLogger.info("Starting server initialization");

const app = express();
app.use(express.json());
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('OK');
  serverRootLogger.debug("Health check request received");
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
        extensions.code = "INTERNAL";
        break;
      default:
        extensions.code = "INTERNAL";
        break;
    }

    if (extensions.code === "INTERNAL") {
      serverRootLogger.error("internal error response", {
        formattedError,
        error,
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

    await server.start();
    serverRootLogger.info("Apollo Server started");

    // GraphQL endpoint
    app.use('/graphql', expressMiddleware(server, {
      context: async ({ req }) => {
        serverRootLogger.debug("Processing GraphQL request", { headers: req.headers });
        return { appContext };
      },
    }));

    const port = Number(process.env.PORT) || 4000;
    const httpServer = http.createServer(app);
    
    await new Promise<void>((resolve) => httpServer.listen({ port }, resolve));
    serverRootLogger.info(`🚀 Server ready at http://0.0.0.0:${port}`);
    serverRootLogger.info(`🚀 GraphQL endpoint available at http://0.0.0.0:${port}/graphql`);
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

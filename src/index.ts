import path from "node:path";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { Probot, Server } from "probot";
import log from "./log.js";
import { robot } from "./bot.js";
import invokeHandler from "../api/kawnix/invoke/index.js";
import workerHandler from "../api/kawnix/worker/index.js";
import maintenanceHandler from "../api/kawnix/maintenance/index.js";

log.info("Starting probot");

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const server = new Server({
  Probot: Probot.defaults({
    appId: process.env.APP_ID,
    baseUrl: process.env.BASE_URL,
    githubToken: process.env.GITHUB_TOKEN,
    privateKey: process.env.PRIVATE_KEY,
    redisConfig: process.env.REDIS_URL,
    secret: process.env.WEBHOOK_SECRET,
  }),
  host: process.env.HOST,
  port,
});

server.expressApp.get("/", (_request, response) => {
  response.sendFile(path.join(process.cwd(), "public", "index.html"));
});

const forwardToWebHandler = (handler: (request: Request) => Promise<Response>) =>
  async (request: ExpressRequest, response: ExpressResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") {
        headers.set(name, value);
      } else if (Array.isArray(value)) {
        headers.set(name, value.join(", "));
      }
    }
    const requestInit: RequestInit & { duplex: "half" } = {
      method: request.method,
      headers,
      body: body.length > 0 ? body : undefined,
      duplex: "half",
    };
    const webRequest = new Request(
      `http://${request.headers.host ?? "localhost"}${request.originalUrl}`,
      requestInit
    );
    const webResponse = await handler(webRequest);
    response.status(webResponse.status);
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));
    response.send(await webResponse.text());
  };

server.expressApp.post(
  "/api/kawnix/invoke",
  forwardToWebHandler(invokeHandler)
);
server.expressApp.post(
  "/api/kawnix/worker",
  forwardToWebHandler(workerHandler)
);
server.expressApp.post(
  "/api/kawnix/maintenance",
  forwardToWebHandler(maintenanceHandler)
);

void (async () => {
  await server.load(robot);
  await server.start();
})();
import path from "node:path";
import { Probot, Server } from "probot";
import log from "./log.js";
import { robot } from "./bot.js";

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

void (async () => {
  await server.load(robot);
  await server.start();
})();
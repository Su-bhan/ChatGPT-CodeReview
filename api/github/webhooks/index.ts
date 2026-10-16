import { createNodeMiddleware, createProbot } from "probot";

import { robot as app } from "../../../src/bot.js"

export const config = {
  runtime: 'nodejs',
};

const probot = createProbot();

export default createNodeMiddleware(app, { probot, webhooksPath: '/api/github/webhooks' });
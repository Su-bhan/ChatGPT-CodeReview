require('./fetch-polyfill.cjs');
// @ts-ignore The CommonJS adapter has no compatible declaration for checkJs.
const { run } = require('@probot/adapter-github-actions');
const { robot } = require('./bot');
require('./log');

run(robot);

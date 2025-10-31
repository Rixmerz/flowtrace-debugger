/**
 * FlowTrace Loader
 * Used with --require flag: node --require flowtrace-agent-js/src/loader.js app.js
 */

// Simply require the agent to install it
require('./agent');

// The agent will automatically hook into module loading

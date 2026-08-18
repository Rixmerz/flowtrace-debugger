'use strict';
// Express golden fixture — the traced unit.
// Only this file is instrumented (FLOWTRACE_PACKAGE_PREFIX=app.js), so the
// harness in run.js and Express's own internals stay out of the trace and the
// event sequence stays deterministic.
//
// Call tree for one GET /orders/7 :
//   handleGetOrder(req, res) [public]
//     loadOrder(id) [public]
//       _rate(total) [private — underscore convention]

const express = require('express');

function _rate(total) {
  return Math.round(total * 0.19);
}

function loadOrder(id) {
  const total = id * 100;
  return { id, total, tax: _rate(total) };
}

function handleGetOrder(req, res) {
  const order = loadOrder(Number(req.params.id));
  res.json(order);
}

function buildApp() {
  const app = express();
  app.get('/orders/:id', handleGetOrder);
  return app;
}

module.exports = { buildApp, loadOrder, handleGetOrder, _rate };

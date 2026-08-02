const express = require('express');
const router = express.Router();
const statsService = require('../services/statsService');
const projectService = require('../services/projectService');
const shared = require('./shared');

router.get('/', (req, res) => {
  const deliveryLogs = projectService.loadDeliveryLog();
  res.json(statsService.compute(shared.projects, deliveryLogs));
});

router.get('/delivery-trend', (req, res) => {
  const logs = projectService.loadDeliveryLog();
  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filtered = logs.filter(l => new Date(l.time) > cutoff);
  const daily = {};
  for (const l of filtered) {
    const day = l.time.slice(0, 10);
    if (!daily[day]) daily[day] = { date: day, ok: 0, fail: 0 };
    daily[day].ok += (l.ok || 0);
    daily[day].fail += (l.fail || 0);
  }
  res.json(Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)));
});

module.exports = router;

const express = require('express');
const router = express.Router();
const sseService = require('../services/sseService');

router.get('/events', (req, res) => {
  sseService.addClient(res);
});

module.exports = router;

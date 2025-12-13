const express = require('express');
const path = require('path');

const router = express.Router();

// Home page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'home.html'));
});

// Live logs page
router.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'logs.html'));
});

// Archived logs page
router.get('/logs/list', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'logs_list.html'));
});

// Docs page
router.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'docs.html'));
});

module.exports = router;

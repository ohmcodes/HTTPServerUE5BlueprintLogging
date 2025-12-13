const express = require('express');
const path = require('path');

const router = express.Router();

// Home page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'home.html'));
});

// Live logs page
router.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'logs.html'));
});

// Archived logs page
router.get('/logs/list', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'logs_list.html'));
});

// Docs page
router.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs.html'));
});

module.exports = router;

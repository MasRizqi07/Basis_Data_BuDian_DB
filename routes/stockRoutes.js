const express = require('express');
const { getStock, getSummary } = require('../controllers/stockController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(getStock));
router.get('/summary', asyncHandler(getSummary));

module.exports = router;

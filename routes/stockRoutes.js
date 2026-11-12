const express = require('express');
const { getCriticalStock, getStock, getSummary } = require('../controllers/stockController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(getStock));
router.get('/summary', asyncHandler(getSummary));
router.get('/critical', asyncHandler(getCriticalStock));

module.exports = router;

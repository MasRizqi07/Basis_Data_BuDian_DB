const express = require('express');
const reportController = require('../controllers/reportController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/sales', asyncHandler(reportController.getSalesReport));
router.get('/stock-movement', asyncHandler(reportController.getStockMovementReport));

module.exports = router;


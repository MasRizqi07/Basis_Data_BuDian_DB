const express = require('express');
const { checkout, getTransactionDetail, listTransactions } = require('../controllers/posController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(listTransactions));
router.get('/:id', asyncHandler(getTransactionDetail));
router.post('/checkout', asyncHandler(checkout));

module.exports = router;

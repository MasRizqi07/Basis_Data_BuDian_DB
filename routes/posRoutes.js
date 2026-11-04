const express = require('express');
const { checkout, getTransactionDetail } = require('../controllers/posController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/:id', asyncHandler(getTransactionDetail));
router.post('/checkout', asyncHandler(checkout));

module.exports = router;

const express = require('express');
const purchase = require('../controllers/purchaseController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(purchase.listPurchases));
router.post('/', asyncHandler(purchase.createPurchase));

module.exports = router;

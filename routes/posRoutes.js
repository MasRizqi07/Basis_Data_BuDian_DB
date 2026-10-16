const express = require('express');
const { checkout } = require('../controllers/posController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.post('/checkout', asyncHandler(checkout));

module.exports = router;

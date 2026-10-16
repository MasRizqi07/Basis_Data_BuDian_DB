const express = require('express');
const { createOpname } = require('../controllers/opnameController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.post('/', asyncHandler(createOpname));

module.exports = router;

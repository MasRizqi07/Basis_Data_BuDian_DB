const express = require('express');
const { createOpname, getOpnameDetail, listOpnames } = require('../controllers/opnameController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(listOpnames));
router.get('/:id', asyncHandler(getOpnameDetail));
router.post('/', asyncHandler(createOpname));

module.exports = router;

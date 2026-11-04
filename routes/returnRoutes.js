const express = require('express');
const returnController = require('../controllers/returnController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/', asyncHandler(returnController.listReturns));
router.get('/references', asyncHandler(returnController.getReturnReferences));
router.get('/:id', asyncHandler(returnController.getReturnDetail));
router.post('/', asyncHandler(returnController.createReturn));

module.exports = router;

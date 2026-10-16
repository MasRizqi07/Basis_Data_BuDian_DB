const express = require('express');
const master = require('../controllers/masterController');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.get('/references', asyncHandler(master.getReferenceData));
router.get('/products', asyncHandler(master.listProducts));
router.post('/products', asyncHandler(master.createProduct));
router.put('/products/:id', asyncHandler(master.updateProduct));
router.delete('/products/:id', asyncHandler(master.deleteProduct));
router.get('/suppliers', asyncHandler(master.listSuppliers));
router.post('/suppliers', asyncHandler(master.createSupplier));
router.put('/suppliers/:id', asyncHandler(master.updateSupplier));
router.delete('/suppliers/:id', asyncHandler(master.deleteSupplier));

module.exports = router;

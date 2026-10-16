const state = {
  references: { categories: [], warehouses: [], employees: [] },
  products: [],
  suppliers: [],
  stock: [],
  posStock: [],
  opnameStock: [],
  returns: [],
  reports: { sales: null, movement: [] },
  cart: new Map()
};

const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(Number(value || 0));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(body.error || 'Permintaan gagal.');
  return body.data;
}

function toast(message, isError = false) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 3200);
}

function setOptions(selector, items, placeholder) {
  const element = document.querySelector(selector);
  const selected = element.value;
  element.innerHTML = `${placeholder ? `<option value="">${placeholder}</option>` : ''}` +
    items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  if (items.some((item) => String(item.id) === selected)) element.value = selected;
}

async function loadReferences() {
  state.references = await api('/api/masters/references');
  setOptions('#warehouse-filter', state.references.warehouses, 'Semua gudang');
  setOptions('#movement-warehouse-filter', state.references.warehouses, 'Semua gudang');
  setOptions('#pos-warehouse', state.references.warehouses);
  setOptions('#opname-warehouse', state.references.warehouses);
  setOptions('#pos-employee', state.references.employees.filter((item) => item.jabatan === 'Kasir' || item.jabatan === 'Admin'));
  setOptions('#opname-employee', state.references.employees);
}

async function loadDashboard() {
  const warehouse = document.querySelector('#warehouse-filter').value;
  const [summary, rows] = await Promise.all([
    api(`/api/stock/summary${warehouse ? `?warehouseId=${encodeURIComponent(warehouse)}` : ''}`),
    api(`/api/stock${warehouse ? `?warehouseId=${encodeURIComponent(warehouse)}` : ''}`)
  ]);
  state.stock = rows;
  document.querySelector('#kpi-products').textContent = Number(summary.total_produk).toLocaleString('id-ID');
  document.querySelector('#kpi-value').textContent = rupiah(summary.total_nilai_stok);
  document.querySelector('#kpi-low').textContent = Number(summary.item_menipis).toLocaleString('id-ID');
  document.querySelector('#kpi-empty').textContent = Number(summary.item_habis).toLocaleString('id-ID');
  renderStock();
}

async function loadPosStock() {
  const warehouseId = document.querySelector('#pos-warehouse').value;
  state.posStock = warehouseId
    ? await api(`/api/stock?warehouseId=${encodeURIComponent(warehouseId)}`)
    : [];
  renderPosProducts();
  renderCart();
}

function availableStock(productId) {
  return Number(state.posStock.find((item) => item.id_produk === productId)?.jumlah_stok || 0);
}

function statusBadge(status) {
  const variant = status === 'Aman' ? 'safe' : status === 'Menipis' ? 'low' : 'out';
  return `<span class="badge ${variant}">${escapeHtml(status)}</span>`;
}

function renderStock() {
  const term = document.querySelector('#stock-search').value.toLowerCase();
  const rows = state.stock.filter((item) =>
    item.nama_produk.toLowerCase().includes(term) || item.kode_barcode.toLowerCase().includes(term)
  );
  document.querySelector('#stock-table').innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td><div class="product-cell"><span class="product-thumb"><i data-lucide="package"></i></span><span><b>${escapeHtml(item.nama_produk)}</b><small>${escapeHtml(item.satuan)} · min. ${item.stok_minimum}</small></span></div></td>
      <td>${escapeHtml(item.kode_barcode)}</td><td>${escapeHtml(item.nama_gudang)}</td>
      <td><span class="stock-number">${item.jumlah_stok}</span> ${escapeHtml(item.satuan)}</td>
      <td>${statusBadge(item.status_stok)}</td><td>${new Date(item.tanggal_update_terakhir).toLocaleString('id-ID')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-state">Produk tidak ditemukan.</td></tr>';
  document.querySelector('#stock-count').textContent = `${rows.length} produk ditampilkan`;
  if (window.lucide) window.lucide.createIcons();
}

async function loadProducts() {
  state.products = await api('/api/masters/products');
  renderProducts();
  renderPosProducts();
  renderOpnameRows();
}

function renderProducts() {
  const rows = state.products.filter((item) => item.aktif);
  document.querySelector('#product-table').innerHTML = rows.length ? rows.map((item) => `
    <tr><td><div class="product-cell"><span class="product-thumb"><i data-lucide="package"></i></span><span><b>${escapeHtml(item.nama_produk)}</b><small>${escapeHtml(item.satuan)} · minimum ${item.stok_minimum}</small></span></div></td>
    <td>${escapeHtml(item.kode_barcode)}</td><td>${escapeHtml(item.nama_kategori)}</td><td>${rupiah(item.harga_beli)}</td><td>${rupiah(item.harga_jual)}</td>
    <td><div class="table-action"><button class="action-button" data-edit-product="${item.id_produk}">Edit</button><button class="action-button" data-delete-product="${item.id_produk}">Nonaktifkan</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Belum ada produk aktif.</td></tr>';
  document.querySelectorAll('[data-edit-product]').forEach((button) => button.addEventListener('click', () => openProductModal(Number(button.dataset.editProduct))));
  document.querySelectorAll('[data-delete-product]').forEach((button) => button.addEventListener('click', () => deactivateProduct(Number(button.dataset.deleteProduct))));
  if (window.lucide) window.lucide.createIcons();
}

function renderSuppliers() {
  document.querySelector('#supplier-table').innerHTML = state.suppliers.length ? state.suppliers.map((item) => `
    <tr><td><div class="product-cell"><span class="product-thumb"><i data-lucide="contact"></i></span><b>${escapeHtml(item.nama_supplier)}</b></div></td>
    <td>${escapeHtml(item.no_telepon || '—')}</td><td>${escapeHtml(item.email || '—')}</td><td>${escapeHtml(item.alamat || '—')}</td>
    <td><div class="table-action"><button class="action-button" data-edit-supplier="${item.id_supplier}">Edit</button><button class="action-button" data-delete-supplier="${item.id_supplier}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Belum ada supplier.</td></tr>';
  document.querySelectorAll('[data-edit-supplier]').forEach((button) => button.addEventListener('click', () => openSupplierModal(Number(button.dataset.editSupplier))));
  document.querySelectorAll('[data-delete-supplier]').forEach((button) => button.addEventListener('click', () => deleteSupplier(Number(button.dataset.deleteSupplier))));
  if (window.lucide) window.lucide.createIcons();
}

function renderPosProducts() {
  const term = document.querySelector('#pos-search').value.toLowerCase();
  const rows = state.products.filter((item) => item.aktif &&
    (item.nama_produk.toLowerCase().includes(term) || item.kode_barcode.toLowerCase().includes(term)));
  document.querySelector('#pos-product-list').innerHTML = rows.map((item) => `
    <div class="product-option"><span class="product-thumb"><i data-lucide="package"></i></span><div><b>${escapeHtml(item.nama_produk)}</b><small>${escapeHtml(item.kode_barcode)} · tersedia ${availableStock(item.id_produk)} ${escapeHtml(item.satuan)}</small></div><strong>${rupiah(item.harga_jual)}</strong><button class="mini-add" data-add-cart="${item.id_produk}" aria-label="Tambah ${escapeHtml(item.nama_produk)}" ${availableStock(item.id_produk) === 0 ? 'disabled' : ''}><i data-lucide="plus"></i></button></div>`).join('') || '<div class="empty-state">Produk tidak ditemukan.</div>';
  document.querySelectorAll('[data-add-cart]').forEach((button) => button.addEventListener('click', () => changeCart(Number(button.dataset.addCart), 1)));
  if (window.lucide) window.lucide.createIcons();
}

function changeCart(id, delta) {
  const product = state.products.find((item) => item.id_produk === id);
  if (!product) return;
  const quantity = (state.cart.get(id) || 0) + delta;
  if (quantity > availableStock(id)) return toast('Stok tidak mencukupi', true);
  if (quantity <= 0) state.cart.delete(id);
  else state.cart.set(id, quantity);
  renderCart();
}

function renderCart() {
  const entries = [...state.cart.entries()];
  document.querySelector('#cart-count').textContent = entries.reduce((sum, entry) => sum + entry[1], 0);
  document.querySelector('#cart-items').innerHTML = entries.length ? entries.map(([id, quantity]) => {
    const item = state.products.find((product) => product.id_produk === id);
    return `<div class="cart-row"><span class="product-thumb"><i data-lucide="package"></i></span><div><b>${escapeHtml(item.nama_produk)}</b><small>${rupiah(item.harga_jual)} / ${escapeHtml(item.satuan)} · stok ${availableStock(id)}</small></div><div class="qty-control"><button data-cart-delta="${id}" data-delta="-1" aria-label="Kurangi">−</button><span>${quantity}</span><button data-cart-delta="${id}" data-delta="1" aria-label="Tambah" ${quantity >= availableStock(id) ? 'disabled' : ''}>+</button></div></div>`;
  }).join('') : '<div class="empty-state">Belum ada produk dipilih.</div>';
  const total = entries.reduce((sum, [id, quantity]) => {
    const item = state.products.find((product) => product.id_produk === id);
    return sum + Number(item.harga_jual) * quantity;
  }, 0);
  document.querySelector('#cart-total').textContent = rupiah(total);
  document.querySelectorAll('[data-cart-delta]').forEach((button) => button.addEventListener('click', () =>
    changeCart(Number(button.dataset.cartDelta), Number(button.dataset.delta))));
  if (window.lucide) window.lucide.createIcons();
}

function renderOpnameRows() {
  document.querySelector('#opname-table').innerHTML = state.opnameStock.length ? state.opnameStock.map((item) => `
    <tr data-opname-row="${item.id_produk}"><td><div class="product-cell"><span class="product-thumb"><i data-lucide="package"></i></span><span><b>${escapeHtml(item.nama_produk)}</b><small>${escapeHtml(item.kode_barcode)}</small></span></div></td><td>${item.jumlah_stok} ${escapeHtml(item.satuan)}</td><td><input class="input-control physical-count" type="number" min="0" step="1" placeholder="—" data-product-id="${item.id_produk}" data-system="${item.jumlah_stok}"></td><td class="difference zero" data-difference-for="${item.id_produk}">—</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">Tidak ada data stok untuk opname.</td></tr>';
  document.querySelectorAll('.physical-count').forEach((input) => input.addEventListener('input', () => {
    const difference = input.value === '' ? null : Number(input.value) - Number(input.dataset.system);
    const cell = document.querySelector(`[data-difference-for="${input.dataset.productId}"]`);
    cell.textContent = difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference}`;
    cell.className = `difference ${difference === null || difference === 0 ? 'zero' : difference > 0 ? 'positive' : 'negative'}`;
  }));
  if (window.lucide) window.lucide.createIcons();
}

async function loadOpnameStock() {
  const warehouseId = document.querySelector('#opname-warehouse').value;
  state.opnameStock = warehouseId
    ? await api(`/api/stock?warehouseId=${encodeURIComponent(warehouseId)}`)
    : [];
  renderOpnameRows();
}

async function loadSuppliers() {
  state.suppliers = await api('/api/masters/suppliers');
  renderSuppliers();
}

async function loadPurchases() {
  const rows = await api('/api/purchases');
  document.querySelector('#purchase-table').innerHTML = rows.length ? rows.map((item) => {
    const isReceived = item.status_pembayaran === 'Diterima';
    const actionCell = isReceived
      ? '<span class="badge safe">Telah Diterima</span>'
      : `<button class="action-button" data-receive-purchase="${item.id_pembelian}">Terima Barang</button>`;
    return `
    <tr>
      <td><b>${escapeHtml(item.no_faktur)}</b></td>
      <td>${new Date(item.tanggal_pembelian).toLocaleDateString('id-ID')}</td>
      <td>${escapeHtml(item.nama_supplier)}</td>
      <td>${escapeHtml(item.nama_karyawan)}</td>
      <td>${item.jumlah_item} item</td>
      <td>${rupiah(item.total_harga)}</td>
      <td><span class="badge ${item.status_pembayaran === 'Diterima' ? 'safe' : item.status_pembayaran === 'Lunas' ? 'safe' : 'low'}">${escapeHtml(item.status_pembayaran)}</span></td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty-state">Belum ada pembelian.</td></tr>';

  document.querySelectorAll('[data-receive-purchase]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.receivePurchase);
      if (!confirm('Konfirmasi penerimaan barang untuk faktur ini? Saldo stok di gudang akan otomatis bertambah.')) return;
      try {
        const res = await api(`/api/purchases/${id}/receive`, {
          method: 'POST',
          body: JSON.stringify({ warehouseId: 1 })
        });
        toast(`Barang faktur ${res.invoiceNumber} berhasil diterima dan stok ditambahkan.`);
        await Promise.all([loadPurchases(), loadDashboard(), loadProducts(), loadPosStock(), loadOpnameStock()]);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function checkout() {
  const items = [...state.cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  if (!items.length) return toast('Tambahkan produk ke keranjang terlebih dahulu.', true);
  try {
    const receipt = await api('/api/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({
        warehouseId: Number(document.querySelector('#pos-warehouse').value),
        employeeId: Number(document.querySelector('#pos-employee').value),
        paymentMethod: document.querySelector('#payment-method').value,
        items
      })
    });
    state.cart.clear();
    renderCart();
    await Promise.all([loadDashboard(), loadProducts(), loadPosStock(), loadOpnameStock()]);
    showReceipt(receipt);
  } catch (error) { toast(error.message, true); }
}

function showReceipt(receipt) {
  const details = receipt.items.map((item) => {
    return `<div style="display:flex;justify-content:space-between;margin:7px 0"><span>${escapeHtml(item.name)} × ${item.quantity}</span><b>${rupiah(item.subtotal)}</b></div>`;
  }).join('');
  openModal(`<h2>Transaksi berhasil</h2><p style="font-size:10px;color:#8791a5">${escapeHtml(receipt.receiptNumber)} · ${escapeHtml(receipt.paymentMethod)}</p>${details}<hr><div style="display:flex;justify-content:space-between;font-size:12px"><b>Total</b><b>${rupiah(receipt.total)}</b></div><div class="modal-actions"><button class="button button-secondary" id="receipt-print">Cetak struk</button><button class="button button-primary" id="receipt-close">Selesai</button></div>`);
  document.querySelector('#receipt-close').addEventListener('click', closeModal);
  document.querySelector('#receipt-print').addEventListener('click', () => printReceipt(receipt));
}

function printReceipt(receipt) {
  const printWindow = window.open('', '_blank', 'width=420,height=640');
  if (!printWindow) return toast('Izinkan pop-up browser untuk mencetak struk.', true);
  const rows = receipt.items.map((item) =>
    `<tr><td>${escapeHtml(item.name)} × ${item.quantity}</td><td>${rupiah(item.subtotal)}</td></tr>`
  ).join('');
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Struk ${escapeHtml(receipt.receiptNumber)}</title><style>body{font:14px Arial,sans-serif;max-width:340px;margin:24px auto;color:#222}h1,p{text-align:center}h1{font-size:20px}p{font-size:12px;color:#555}table{width:100%;border-collapse:collapse;margin:18px 0}td{padding:7px 0;border-bottom:1px dashed #bbb}td:last-child{text-align:right;white-space:nowrap}.total{display:flex;justify-content:space-between;font-weight:bold;border-top:1px solid #333;padding-top:12px}</style></head><body><h1>Urban Mart</h1><p>${escapeHtml(receipt.receiptNumber)}<br>${escapeHtml(receipt.paymentMethod)}</p><table>${rows}</table><div class="total"><span>Total</span><span>${rupiah(receipt.total)}</span></div><p>Terima kasih telah berbelanja</p><script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
}

function openModal(content) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal">${content}</div>`;
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
  document.body.append(backdrop);
}
function closeModal() { document.querySelector('#active-modal')?.remove(); }

function openProductModal(id = null) {
  const item = state.products.find((product) => product.id_produk === id);
  const categories = state.references.categories.map((category) =>
    `<option value="${category.id}" ${item?.id_kategori === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  openModal(`<h2>${item ? 'Edit produk' : 'Tambah produk'}</h2><form id="product-form">
    <label>Barcode<input name="barcode" required value="${escapeHtml(item?.kode_barcode || '')}"></label>
    <label>Nama produk<input name="name" required value="${escapeHtml(item?.nama_produk || '')}"></label>
    <label>Kategori<select name="categoryId" required>${categories}</select></label>
    <div class="form-row"><label>Harga beli<input name="purchasePrice" type="number" min="0" required value="${item?.harga_beli ?? 0}"></label><label>Harga jual<input name="salePrice" type="number" min="0" required value="${item?.harga_jual ?? ''}"></label></div>
    <div class="form-row"><label>Satuan<input name="unit" required value="${escapeHtml(item?.satuan || 'pcs')}"></label><label>Stok minimum<input name="minimumStock" type="number" min="0" required value="${item?.stok_minimum ?? 5}"></label></div>
    <div class="modal-actions"><button type="button" class="button button-secondary" id="modal-cancel">Batal</button><button class="button button-primary">Simpan produk</button></div></form>`);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { ...values, categoryId: Number(values.categoryId), purchasePrice: Number(values.purchasePrice), salePrice: Number(values.salePrice), minimumStock: Number(values.minimumStock), active: item?.aktif ?? true };
    try {
      await api(item ? `/api/masters/products/${id}` : '/api/masters/products', { method: item ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeModal(); toast('Data produk tersimpan.');
      await Promise.all([loadProducts(), loadDashboard(), loadPosStock(), loadOpnameStock()]);
    } catch (error) { toast(error.message, true); }
  });
}

async function deactivateProduct(id) {
  if (!confirm('Nonaktifkan produk ini? Riwayat transaksi tetap disimpan.')) return;
  try {
    await api(`/api/masters/products/${id}`, { method: 'DELETE' });
    toast('Produk dinonaktifkan.');
    await Promise.all([loadProducts(), loadDashboard(), loadPosStock(), loadOpnameStock()]);
  } catch (error) { toast(error.message, true); }
}

function openSupplierModal(id = null) {
  const supplier = state.suppliers.find((item) => item.id_supplier === id);
  openModal(`<h2>${supplier ? 'Edit supplier' : 'Tambah supplier'}</h2><form id="supplier-form">
    <label>Nama supplier<input name="name" required value="${escapeHtml(supplier?.nama_supplier || '')}"></label>
    <label>Kontak person<input name="contactPerson" value="${escapeHtml(supplier?.kontak_person || '')}"></label>
    <label>Telepon<input name="phone" value="${escapeHtml(supplier?.no_telepon || '')}"></label>
    <label>Email<input name="email" type="email" value="${escapeHtml(supplier?.email || '')}"></label>
    <label>Alamat<textarea name="address" rows="3">${escapeHtml(supplier?.alamat || '')}</textarea></label>
    <div class="modal-actions"><button type="button" class="button button-secondary" id="modal-cancel">Batal</button><button class="button button-primary">Simpan supplier</button></div></form>`);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#supplier-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(supplier ? `/api/masters/suppliers/${id}` : '/api/masters/suppliers', { method: supplier ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeModal(); toast('Data supplier tersimpan.'); await loadSuppliers();
    } catch (error) { toast(error.message, true); }
  });
}

async function deleteSupplier(id) {
  if (!confirm('Hapus supplier ini? Supplier yang masih dipakai transaksi tidak dapat dihapus.')) return;
  try {
    await api(`/api/masters/suppliers/${id}`, { method: 'DELETE' });
    toast('Supplier dihapus.'); await loadSuppliers();
  } catch (error) { toast(error.message, true); }
}

function openPurchaseModal() {
  if (!state.products.some((item) => item.aktif) || !state.suppliers.length) {
    return toast('Tambahkan produk dan supplier sebelum membuat PO.', true);
  }
  const supplierOptions = state.suppliers.map((item) => `<option value="${item.id_supplier}">${escapeHtml(item.nama_supplier)}</option>`).join('');
  const productOptions = state.products.filter((item) => item.aktif).map((item) =>
    `<option value="${item.id_produk}">${escapeHtml(item.nama_produk)} — ${rupiah(item.harga_beli)}</option>`).join('');
  const employeeOptions = state.references.employees.filter((item) => item.jabatan === 'Purchasing').map((item) =>
    `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  if (!employeeOptions) return toast('Tambahkan karyawan Purchasing sebelum membuat pembelian.', true);
  openModal(`<h2>Catat pembelian</h2><form id="purchase-form"><div class="form-row">
    <label>Supplier<select name="supplierId">${supplierOptions}</select></label>
    <label>Petugas Purchasing<select name="employeeId">${employeeOptions}</select></label></div>
    <label>Item pembelian</label><div class="purchase-items" id="purchase-items"></div>
    <button type="button" class="text-button" id="add-purchase-item">+ Tambah item</button>
    <div class="modal-actions"><button type="button" class="button button-secondary" id="modal-cancel">Batal</button><button class="button button-primary">Simpan PO</button></div></form>`);
  const addLine = () => {
    const row = document.createElement('div');
    row.className = 'purchase-item';
    row.innerHTML = `<select class="purchase-product">${productOptions}</select><input class="purchase-quantity" type="number" min="1" value="1" aria-label="Jumlah"><input class="purchase-price" type="number" min="0" step="100" aria-label="Harga beli"><button type="button" aria-label="Hapus item">×</button>`;
    const select = row.querySelector('.purchase-product');
    const syncPrice = () => {
      const product = state.products.find((item) => item.id_produk === Number(select.value));
      row.querySelector('.purchase-price').value = product?.harga_beli || 0;
    };
    select.addEventListener('change', syncPrice);
    row.querySelector('button').addEventListener('click', () => row.remove());
    document.querySelector('#purchase-items').append(row);
    syncPrice();
  };
  document.querySelector('#add-purchase-item').addEventListener('click', addLine);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  addLine();
  document.querySelector('#purchase-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const items = [...form.querySelectorAll('.purchase-item')].map((row) => ({
      productId: Number(row.querySelector('.purchase-product').value),
      quantity: Number(row.querySelector('.purchase-quantity').value),
      unitPrice: Number(row.querySelector('.purchase-price').value)
    }));
    try {
      await api('/api/purchases', { method: 'POST', body: JSON.stringify({
        supplierId: Number(values.supplierId),
        employeeId: Number(values.employeeId), items
      }) });
      closeModal(); toast('Pembelian berhasil dicatat.'); await loadPurchases();
    } catch (error) { toast(error.message, true); }
  });
}

async function loadReturns() {
  state.returns = await api('/api/returns');
  renderReturns();
}

function renderReturns() {
  const filterType = document.querySelector('#return-type-filter')?.value || '';
  const rows = state.returns.filter((item) => !filterType || item.jenis_retur === filterType);
  document.querySelector('#return-table').innerHTML = rows.length ? rows.map((item) => {
    const refCode = item.no_faktur || item.no_transaksi || '—';
    const typeBadge = item.jenis_retur === 'Dari Pelanggan' ? 'safe' : 'low';
    return `
      <tr>
        <td><b>${escapeHtml(item.no_retur)}</b></td>
        <td>${new Date(item.tanggal_retur).toLocaleDateString('id-ID')}</td>
        <td><span class="badge ${typeBadge}">${escapeHtml(item.jenis_retur)}</span></td>
        <td><span style="font-family:monospace;font-size:10px">${escapeHtml(refCode)}</span></td>
        <td>${escapeHtml(item.nama_gudang)}</td>
        <td>${escapeHtml(item.nama_karyawan)}</td>
        <td><b>${rupiah(item.total_nilai_retur)}</b></td>
        <td><span class="badge safe">${escapeHtml(item.status_retur)}</span></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="8" class="empty-state">Belum ada transaksi retur.</td></tr>';
  if (window.lucide) window.lucide.createIcons();
}

async function openReturnModal() {
  const refs = await api('/api/returns/references');
  const warehouseOptions = state.references.warehouses.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  const employeeOptions = state.references.employees.map((e) => `<option value="${e.id}">${escapeHtml(e.name)} (${escapeHtml(e.jabatan)})</option>`).join('');
  const productOptions = state.products.filter((p) => p.aktif).map((p) =>
    `<option value="${p.id_produk}" data-beli="${p.harga_beli}" data-jual="${p.harga_jual}">${escapeHtml(p.nama_produk)}</option>`
  ).join('');

  openModal(`
    <h2>Catat Transaksi Retur</h2>
    <form id="return-form">
      <div class="form-row">
        <label>Jenis Retur
          <select name="returnType" id="ret-modal-type">
            <option value="Ke Supplier">Ke Supplier (Pengembalian Barang Rusak/Expired)</option>
            <option value="Dari Pelanggan">Dari Pelanggan (Barang Dikembalikan Customer)</option>
          </select>
        </label>
        <label>Gudang
          <select name="warehouseId">${warehouseOptions}</select>
        </label>
      </div>
      <div class="form-row">
        <label>Referensi Asal (Faktur PO / Struk Kasir)
          <select name="referenceId" id="ret-modal-ref"></select>
        </label>
        <label>Petugas Penanggung Jawab
          <select name="employeeId">${employeeOptions}</select>
        </label>
      </div>
      <label>Item Retur</label>
      <div class="purchase-items" id="return-items"></div>
      <button type="button" class="text-button" id="add-return-item">+ Tambah item retur</button>
      <div class="modal-actions">
        <button type="button" class="button button-secondary" id="modal-cancel">Batal</button>
        <button class="button button-primary">Simpan Transaksi Retur</button>
      </div>
    </form>
  `);

  const syncRefOptions = () => {
    const isSupplier = document.querySelector('#ret-modal-type').value === 'Ke Supplier';
    const list = isSupplier ? refs.purchases : refs.sales;
    const refSelect = document.querySelector('#ret-modal-ref');
    if (!list || !list.length) {
      refSelect.innerHTML = `<option value="">Tidak ada ${isSupplier ? 'faktur pembelian' : 'struk penjualan'}</option>`;
    } else {
      refSelect.innerHTML = list.map((item) => `<option value="${item.id}">${escapeHtml(item.label || item.code)}</option>`).join('');
    }
  };

  const syncPrice = (row) => {
    const select = row.querySelector('.return-product');
    const opt = select.options[select.selectedIndex];
    const isSupplier = document.querySelector('#ret-modal-type').value === 'Ke Supplier';
    const price = isSupplier ? opt?.dataset.beli : opt?.dataset.jual;
    row.querySelector('.return-price').value = price || 0;
  };

  document.querySelector('#ret-modal-type').addEventListener('change', () => {
    syncRefOptions();
    document.querySelectorAll('.return-item').forEach((row) => syncPrice(row));
  });

  const addLine = () => {
    const row = document.createElement('div');
    row.className = 'purchase-item return-item';
    row.innerHTML = `
      <select class="return-product">${productOptions}</select>
      <input class="return-quantity" type="number" min="1" value="1" placeholder="Qty">
      <input class="return-price" type="number" min="0" placeholder="Harga">
      <select class="return-reason" style="width:110px">
        <option value="Rusak">Rusak</option>
        <option value="Kadaluarsa">Kadaluarsa</option>
        <option value="Tidak Sesuai">Tidak Sesuai</option>
      </select>
      <button type="button" aria-label="Hapus item">×</button>
    `;
    const sel = row.querySelector('.return-product');
    sel.addEventListener('change', () => syncPrice(row));
    row.querySelector('button').addEventListener('click', () => row.remove());
    document.querySelector('#return-items').append(row);
    syncPrice(row);
  };

  document.querySelector('#add-return-item').addEventListener('click', addLine);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  syncRefOptions();
  addLine();

  document.querySelector('#return-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const items = [...form.querySelectorAll('.return-item')].map((row) => ({
      productId: Number(row.querySelector('.return-product').value),
      quantity: Number(row.querySelector('.return-quantity').value),
      unitPrice: Number(row.querySelector('.return-price').value),
      reason: row.querySelector('.return-reason').value
    }));

    if (!items.length) return toast('Tambahkan minimal satu item barang untuk retur.', true);
    if (!values.referenceId) return toast('Pilih dokumen referensi asal retur.', true);

    try {
      const res = await api('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          returnType: values.returnType,
          warehouseId: Number(values.warehouseId),
          employeeId: Number(values.employeeId),
          referenceId: Number(values.referenceId),
          items
        })
      });
      closeModal();
      toast(`Retur ${res.returnNumber} berhasil diproses dan saldo stok disesuaikan.`);
      await Promise.all([loadReturns(), loadDashboard(), loadProducts(), loadPosStock(), loadOpnameStock()]);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function loadReports() {
  const warehouse = document.querySelector('#movement-warehouse-filter')?.value || '';
  const [salesData, movementRows] = await Promise.all([
    api('/api/reports/sales'),
    api(`/api/reports/stock-movement${warehouse ? `?warehouseId=${encodeURIComponent(warehouse)}` : ''}`)
  ]);

  state.reports = { sales: salesData, movement: movementRows };

  const { summary, fastMoving } = salesData;
  document.querySelector('#rep-omzet').textContent = rupiah(summary.total_omzet);
  document.querySelector('#rep-transaksi').textContent = Number(summary.total_transaksi).toLocaleString('id-ID');
  document.querySelector('#rep-avg').textContent = rupiah(summary.rata_rata_transaksi);
  document.querySelector('#rep-top-product').textContent = fastMoving.length
    ? `${fastMoving[0].nama_produk} (${fastMoving[0].total_terjual} ${fastMoving[0].satuan})`
    : '—';

  document.querySelector('#fast-moving-table').innerHTML = fastMoving.length ? fastMoving.map((item) => `
    <tr>
      <td><div class="product-cell"><span class="product-thumb"><i data-lucide="flame"></i></span><b>${escapeHtml(item.nama_produk)}</b></div></td>
      <td>${escapeHtml(item.barcode)}</td>
      <td>${escapeHtml(item.nama_kategori)}</td>
      <td><b>${item.total_terjual}</b> ${escapeHtml(item.satuan)}</td>
      <td>${rupiah(item.total_pendapatan)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-state">Belum ada transaksi penjualan produk.</td></tr>';

  document.querySelector('#stock-movement-table').innerHTML = movementRows.length ? movementRows.map((item) => `
    <tr>
      <td><div class="product-cell"><span class="product-thumb"><i data-lucide="package"></i></span><b>${escapeHtml(item.nama_produk)}</b></div></td>
      <td>${escapeHtml(item.nama_gudang)}</td>
      <td><span class="stock-number">${item.stok_saat_ini}</span> ${escapeHtml(item.satuan)}</td>
      <td style="color:#2f9e44">+${item.total_masuk_pengadaan}</td>
      <td style="color:#2f9e44">+${item.total_masuk_retur}</td>
      <td style="color:#e03131">-${item.total_keluar_penjualan}</td>
      <td style="color:#e03131">-${item.total_keluar_retur}</td>
      <td class="difference ${item.total_penyesuaian_opname > 0 ? 'positive' : item.total_penyesuaian_opname < 0 ? 'negative' : 'zero'}">${item.total_penyesuaian_opname > 0 ? '+' : ''}${item.total_penyesuaian_opname}</td>
      <td>${statusBadge(item.status_stok)}</td>
    </tr>
  `).join('') : '<tr><td colspan="9" class="empty-state">Data mutasi belum tersedia.</td></tr>';

  if (window.lucide) window.lucide.createIcons();
}

function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast(`File ${filename} berhasil diunduh.`);
}

function exportSalesCSV() {
  if (!state.reports?.sales) return toast('Data penjualan belum siap diekspor.', true);
  const { summary, fastMoving, paymentBreakdown } = state.reports.sales;
  let csv = 'REKAP PENJUALAN MINIMARKET\r\n';
  csv += `Total Transaksi,${summary.total_transaksi}\r\n`;
  csv += `Total Omzet,${summary.total_omzet}\r\n`;
  csv += `Rata-Rata Transaksi,${summary.rata_rata_transaksi}\r\n\r\n`;

  csv += 'METODE PEMBAYARAN,JUMLAH TRANSAKSI,TOTAL NOMINAL\r\n';
  paymentBreakdown.forEach((p) => {
    csv += `"${p.metode_pembayaran}",${p.jumlah_transaksi},${p.total_nominal}\r\n`;
  });
  csv += '\r\nPRODUK TERLARIS (FAST MOVING),BARCODE,KATEGORI,JUMLAH TERJUAL,TOTAL PENDAPATAN\r\n';
  fastMoving.forEach((p) => {
    csv += `"${p.nama_produk}","${p.barcode}","${p.nama_kategori}",${p.total_terjual},${p.total_pendapatan}\r\n`;
  });

  downloadCSV(`Laporan_Penjualan_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function exportMovementCSV() {
  if (!state.reports?.movement?.length) return toast('Data mutasi stok belum siap diekspor.', true);
  let csv = 'PRODUK,BARCODE,GUDANG,STOK SAAT INI,MASUK PENGADAAN,MASUK RETUR PELANGGAN,KELUAR KASIR POS,KELUAR RETUR SUPPLIER,PENYESUAIAN OPNAME,STATUS\r\n';
  state.reports.movement.forEach((m) => {
    csv += `"${m.nama_produk}","${m.barcode}","${m.nama_gudang}",${m.stok_saat_ini},${m.total_masuk_pengadaan},${m.total_masuk_retur},${m.total_keluar_penjualan},${m.total_keluar_retur},${m.total_penyesuaian_opname},"${m.status_stok}"\r\n`;
  });

  downloadCSV(`Kartu_Mutasi_Stok_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function printReports() {
  window.print();
}

function switchPage(name) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === name));
  const active = document.querySelector(`.nav-link[data-page="${name}"]`);
  document.querySelector('#breadcrumb-current').textContent = active?.textContent.trim() || 'Dashboard';
  document.querySelector('.sidebar').classList.remove('open');
  if (name === 'purchases') loadPurchases().catch((error) => toast(error.message, true));
  if (name === 'returns') loadReturns().catch((error) => toast(error.message, true));
  if (name === 'reports') loadReports().catch((error) => toast(error.message, true));
  if (name === 'products') loadProducts().catch((error) => toast(error.message, true));
  if (name === 'suppliers') loadSuppliers().catch((error) => toast(error.message, true));
}

async function saveOpname() {
  const items = [...document.querySelectorAll('.physical-count')]
    .filter((input) => input.value !== '')
    .map((input) => ({ productId: Number(input.dataset.productId), physical: Number(input.value) }));
  if (!items.length) return toast('Isi setidaknya satu jumlah stok fisik.', true);
  try {
    const result = await api('/api/opname', { method: 'POST', body: JSON.stringify({
      warehouseId: Number(document.querySelector('#opname-warehouse').value),
      employeeId: Number(document.querySelector('#opname-employee').value),
      notes: document.querySelector('#opname-notes').value,
      items
    }) });
    toast(`Opname ${result.opnameNumber} berhasil disimpan dan stok disesuaikan.`);
    document.querySelector('#opname-notes').value = '';
    await Promise.all([loadDashboard(), loadOpnameStock()]);
  } catch (error) { toast(error.message, true); }
}

document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
document.querySelectorAll('[data-goto]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.goto)));
document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelector('#refresh-button').addEventListener('click', () => Promise.all([loadDashboard(), loadProducts()]).then(() => toast('Data berhasil dimuat ulang.')).catch((error) => toast(error.message, true)));
document.querySelector('#stock-refresh').addEventListener('click', () => loadDashboard().catch((error) => toast(error.message, true)));
document.querySelector('#warehouse-filter').addEventListener('change', () => loadDashboard().catch((error) => toast(error.message, true)));
document.querySelector('#pos-warehouse').addEventListener('change', () => {
  state.cart.clear();
  renderCart();
  loadPosStock().catch((error) => toast(error.message, true));
});
document.querySelector('#opname-warehouse').addEventListener('change', () => loadOpnameStock().catch((error) => toast(error.message, true)));
document.querySelector('#stock-search').addEventListener('input', renderStock);
document.querySelector('#pos-search').addEventListener('input', renderPosProducts);
document.querySelector('#clear-cart').addEventListener('click', () => { state.cart.clear(); renderCart(); });
document.querySelector('#checkout-button').addEventListener('click', checkout);
document.querySelector('#save-opname').addEventListener('click', saveOpname);
document.querySelector('#new-product').addEventListener('click', () => openProductModal());
document.querySelector('#new-supplier').addEventListener('click', () => openSupplierModal());
document.querySelector('#new-purchase').addEventListener('click', openPurchaseModal);
document.querySelector('#new-return')?.addEventListener('click', openReturnModal);
document.querySelector('#return-type-filter')?.addEventListener('change', renderReturns);
document.querySelector('#movement-warehouse-filter')?.addEventListener('change', loadReports);
document.querySelector('#export-sales-csv')?.addEventListener('click', exportSalesCSV);
document.querySelector('#export-movement-csv')?.addEventListener('click', exportMovementCSV);
document.querySelector('#print-reports')?.addEventListener('click', printReports);

(async function initialize() {
  try {
    document.querySelector('.page-heading .eyebrow').textContent = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
    }).format(new Date()).toLocaleUpperCase('id-ID');
    await loadReferences();
    await Promise.all([loadDashboard(), loadProducts(), loadSuppliers(), loadOpnameStock(), loadPosStock()]);
    renderCart();
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    toast(`Tidak dapat memuat aplikasi: ${error.message}`, true);
  }
})();

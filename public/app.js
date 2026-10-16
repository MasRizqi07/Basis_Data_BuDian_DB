/**
 * STOCKWISE — MINIMARKET INVENTORY MANAGEMENT SYSTEM (14 TABEL 3NF)
 * Frontend Application Controller with Chart.js Visualizations & POS Calculator
 */

const state = {
  references: { categories: [], warehouses: [], employees: [] },
  products: [],
  suppliers: [],
  stock: [],
  posStock: [],
  opnameStock: [],
  returns: [],
  purchases: [],
  reports: { sales: null, movement: [] },
  cart: new Map(),
  selectedPosCategory: '',
  charts: {
    salesTrend: null,
    paymentBreakdown: null
  }
};

// ============================================================================
// Formatting & Utilities
// ============================================================================

const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
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
  if (!response.ok) throw new Error(body.error || 'Permintaan gagal diproses server.');
  return body.data;
}

function toast(message, isError = false) {
  const node = document.querySelector('#toast');
  if (!node) return;
  node.innerHTML = `<span>${isError ? '⚠️' : '✓'}</span> <span>${escapeHtml(message)}</span>`;
  node.classList.toggle('error', isError);
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 3500);
}

function setOptions(selector, items, placeholder) {
  const element = document.querySelector(selector);
  if (!element) return;
  const selected = element.value;
  element.innerHTML = `${placeholder ? `<option value="">${placeholder}</option>` : ''}` +
    items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  if (items.some((item) => String(item.id) === selected)) element.value = selected;
}

function statusBadge(status) {
  const variant = status === 'Aman' ? 'safe' : status === 'Menipis' ? 'low' : 'out';
  return `<span class="badge ${variant}">${escapeHtml(status)}</span>`;
}

// Live Digital Clock (WIB)
function startLiveClock() {
  const update = () => {
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta'
    }).format(now);
    const clockElem = document.querySelector('#live-clock');
    if (clockElem) {
      clockElem.innerHTML = `<i data-lucide="clock"></i> ${timeStr} WIB`;
      if (window.lucide) window.lucide.createIcons();
    }
  };
  update();
  setInterval(update, 1000);
}

// ============================================================================
// References & Initial Loading
// ============================================================================

async function loadReferences() {
  state.references = await api('/api/masters/references');
  setOptions('#warehouse-filter', state.references.warehouses, 'Semua Lokasi Gudang');
  setOptions('#movement-warehouse-filter', state.references.warehouses, 'Semua Gudang');
  setOptions('#pos-warehouse', state.references.warehouses);
  setOptions('#opname-warehouse', state.references.warehouses);
  setOptions('#pos-employee', state.references.employees.filter((item) => item.jabatan === 'Kasir' || item.jabatan === 'Admin'));
  setOptions('#opname-employee', state.references.employees);
}

// ============================================================================
// TAB 1: Dashboard Stok
// ============================================================================

async function loadDashboard() {
  const warehouse = document.querySelector('#warehouse-filter')?.value || '';
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

function renderStock() {
  const term = document.querySelector('#stock-search')?.value.toLowerCase().trim() || '';
  const rows = state.stock.filter((item) =>
    item.nama_produk.toLowerCase().includes(term) || item.kode_barcode.toLowerCase().includes(term)
  );
  const tbody = document.querySelector('#stock-table');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td>
        <div class="product-cell">
          <span class="product-thumb"><i data-lucide="package"></i></span>
          <div>
            <b>${escapeHtml(item.nama_produk)}</b>
            <small>${escapeHtml(item.satuan)} · Ambang batas min. ${item.stok_minimum}</small>
          </div>
        </div>
      </td>
      <td><span style="font-family:var(--font-mono);font-size:12px">${escapeHtml(item.kode_barcode)}</span></td>
      <td>${escapeHtml(item.nama_gudang)}</td>
      <td><span class="stock-number">${item.jumlah_stok}</span> ${escapeHtml(item.satuan)}</td>
      <td>${statusBadge(item.status_stok)}</td>
      <td><span style="font-size:11px;color:var(--text-muted)">${new Date(item.tanggal_update_terakhir).toLocaleString('id-ID')}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-state">Produk tidak ditemukan dalam pencarian.</td></tr>';
  
  const countElem = document.querySelector('#stock-count');
  if (countElem) countElem.textContent = `${rows.length} produk ditampilkan`;
  if (window.lucide) window.lucide.createIcons();
}

// ============================================================================
// TAB 2: Kasir / Point of Sale (POS)
// ============================================================================

async function loadPosStock() {
  const warehouseId = document.querySelector('#pos-warehouse')?.value;
  state.posStock = warehouseId
    ? await api(`/api/stock?warehouseId=${encodeURIComponent(warehouseId)}`)
    : [];
  renderPosProducts();
  renderCart();
}

function availableStock(productId) {
  return Number(state.posStock.find((item) => item.id_produk === productId)?.jumlah_stok || 0);
}

function renderPosProducts() {
  const term = document.querySelector('#pos-search')?.value.toLowerCase().trim() || '';
  const categoryFilter = state.selectedPosCategory;

  const rows = state.products.filter((item) => {
    if (!item.aktif) return false;
    const matchCategory = !categoryFilter || item.nama_kategori === categoryFilter;
    const matchTerm = !term || item.nama_produk.toLowerCase().includes(term) || item.kode_barcode.toLowerCase().includes(term);
    return matchCategory && matchTerm;
  });

  const container = document.querySelector('#pos-product-list');
  if (!container) return;

  container.innerHTML = rows.map((item) => {
    const stockQty = availableStock(item.id_produk);
    const isOut = stockQty <= 0;
    return `
      <div class="product-option">
        <span class="product-thumb"><i data-lucide="package"></i></span>
        <div>
          <b>${escapeHtml(item.nama_produk)}</b>
          <small><span style="font-family:var(--font-mono)">${escapeHtml(item.kode_barcode)}</span> · Tersedia <b>${stockQty}</b> ${escapeHtml(item.satuan)}</small>
        </div>
        <strong>${rupiah(item.harga_jual)}</strong>
        <button class="mini-add" data-add-cart="${item.id_produk}" aria-label="Tambah ${escapeHtml(item.nama_produk)}" ${isOut ? 'disabled title="Stok habis"' : 'title="Tambah ke keranjang"'}>
          <i data-lucide="plus"></i>
        </button>
      </div>
    `;
  }).join('') || '<div class="empty-state">Tidak ada produk yang cocok dengan pencarian/kategori ini.</div>';

  container.querySelectorAll('[data-add-cart]').forEach((button) => {
    button.addEventListener('click', () => changeCart(Number(button.dataset.addCart), 1));
  });

  if (window.lucide) window.lucide.createIcons();
}

function changeCart(id, delta) {
  const product = state.products.find((item) => item.id_produk === id);
  if (!product) return;
  const current = state.cart.get(id) || 0;
  const quantity = current + delta;
  const maxStock = availableStock(id);

  if (quantity > maxStock) {
    return toast(`Stok tidak mencukupi! Hanya tersedia ${maxStock} ${product.satuan}.`, true);
  }
  if (quantity <= 0) {
    state.cart.delete(id);
  } else {
    state.cart.set(id, quantity);
  }
  renderCart();
  renderPosProducts();
}

function calculateCartTotal() {
  let total = 0;
  for (const [id, quantity] of state.cart.entries()) {
    const item = state.products.find((p) => p.id_produk === id);
    if (item) total += Number(item.harga_jual) * quantity;
  }
  return total;
}

function updateChangeCalculation() {
  const method = document.querySelector('#payment-method')?.value || 'Tunai';
  const cashCalculator = document.querySelector('#pos-cash-calculator');
  if (cashCalculator) {
    cashCalculator.style.display = method === 'Tunai' ? 'block' : 'none';
  }

  if (method !== 'Tunai') return;

  const total = calculateCartTotal();
  const cashInput = Number(document.querySelector('#pos-cash-input')?.value || 0);
  const changeDisplay = document.querySelector('#pos-change-display');
  const changeValue = document.querySelector('#pos-change-value');
  if (!changeDisplay || !changeValue) return;

  if (cashInput === 0) {
    changeDisplay.className = 'change-display exact';
    changeDisplay.querySelector('span').textContent = 'Masukkan Uang Pembeli';
    changeValue.textContent = 'Rp0';
    return;
  }

  const diff = cashInput - total;
  if (diff > 0) {
    changeDisplay.className = 'change-display safe';
    changeDisplay.querySelector('span').textContent = 'Kembalian Pembeli';
    changeValue.textContent = rupiah(diff);
  } else if (diff === 0) {
    changeDisplay.className = 'change-display exact';
    changeDisplay.querySelector('span').textContent = 'Uang Pas';
    changeValue.textContent = 'Rp0';
  } else {
    changeDisplay.className = 'change-display danger';
    changeDisplay.querySelector('span').textContent = 'Uang Kurang';
    changeValue.textContent = `-${rupiah(Math.abs(diff))}`;
  }
}

function renderCart() {
  const entries = [...state.cart.entries()];
  const totalCount = entries.reduce((sum, entry) => sum + entry[1], 0);
  document.querySelector('#cart-count').textContent = totalCount;

  const container = document.querySelector('#cart-items');
  if (!container) return;

  container.innerHTML = entries.length ? entries.map(([id, quantity]) => {
    const item = state.products.find((product) => product.id_produk === id);
    const subtotal = Number(item.harga_jual) * quantity;
    const maxStock = availableStock(id);
    return `
      <div class="cart-row">
        <span class="product-thumb"><i data-lucide="package"></i></span>
        <div>
          <b>${escapeHtml(item.nama_produk)}</b>
          <small>${rupiah(item.harga_jual)} / ${escapeHtml(item.satuan)} · Subtotal: <b>${rupiah(subtotal)}</b></small>
        </div>
        <div class="qty-control">
          <button data-cart-delta="${id}" data-delta="-1" aria-label="Kurangi" title="Kurangi">−</button>
          <span>${quantity}</span>
          <button data-cart-delta="${id}" data-delta="1" aria-label="Tambah" title="Tambah" ${quantity >= maxStock ? 'disabled' : ''}>+</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state">Belum ada produk dipilih dalam keranjang.</div>';

  const total = calculateCartTotal();
  document.querySelector('#cart-total').textContent = rupiah(total);

  container.querySelectorAll('[data-cart-delta]').forEach((button) => {
    button.addEventListener('click', () => changeCart(Number(button.dataset.cartDelta), Number(button.dataset.delta)));
  });

  updateChangeCalculation();
  if (window.lucide) window.lucide.createIcons();
}

async function checkout() {
  const items = [...state.cart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  if (!items.length) return toast('Tambahkan produk ke keranjang terlebih dahulu.', true);

  const paymentMethod = document.querySelector('#payment-method').value;
  const total = calculateCartTotal();
  const cashInput = Number(document.querySelector('#pos-cash-input')?.value || 0);

  if (paymentMethod === 'Tunai' && cashInput > 0 && cashInput < total) {
    return toast(`Nominal uang tunai kurang ${rupiah(total - cashInput)}!`, true);
  }

  const warehouseId = Number(document.querySelector('#pos-warehouse').value);
  const employeeId = Number(document.querySelector('#pos-employee').value);

  try {
    const checkoutButton = document.querySelector('#checkout-button');
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Memproses Transaksi...';

    const receipt = await api('/api/pos/checkout', {
      method: 'POST',
      body: JSON.stringify({ warehouseId, employeeId, paymentMethod, items })
    });

    state.cart.clear();
    if (document.querySelector('#pos-cash-input')) {
      document.querySelector('#pos-cash-input').value = '';
    }
    renderCart();

    await Promise.all([loadDashboard(), loadProducts(), loadPosStock(), loadOpnameStock()]);
    showReceipt({
      ...receipt,
      cashReceived: paymentMethod === 'Tunai' && cashInput > 0 ? cashInput : total,
      changeAmount: paymentMethod === 'Tunai' && cashInput > total ? cashInput - total : 0
    });
    toast('Transaksi berhasil dicatat dan saldo stok diperbarui.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    const checkoutButton = document.querySelector('#checkout-button');
    checkoutButton.disabled = false;
    checkoutButton.innerHTML = '<i data-lucide="receipt"></i> Proses Pembayaran & Cetak Struk';
    if (window.lucide) window.lucide.createIcons();
  }
}

function showReceipt(receipt) {
  const details = receipt.items.map((item) => `
    <div class="receipt-item-row">
      <span>${escapeHtml(item.name)} × ${item.quantity}</span>
      <b>${rupiah(item.subtotal)}</b>
    </div>
  `).join('');

  const cashReceived = receipt.cashReceived || receipt.total;
  const change = receipt.changeAmount || 0;

  openModal(`
    <div class="modal-header">
      <h2>Struk Pembayaran</h2>
      <button class="modal-close" id="receipt-modal-close" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <div class="receipt-box" id="printable-receipt">
      <div class="receipt-header">
        <h3>URBAN MART MINIMARKET</h3>
        <p>Jl. Merdeka No. 45, Jakarta Pusat · Telp: 021-5550101</p>
        <p style="margin-top:6px">Faktur: <b>${escapeHtml(receipt.receiptNumber)}</b></p>
        <p>Waktu: ${new Date().toLocaleString('id-ID')} · Metode: <b>${escapeHtml(receipt.paymentMethod)}</b></p>
      </div>
      <hr class="receipt-divider">
      ${details}
      <hr class="receipt-divider">
      <div class="receipt-total-row">
        <span>TOTAL BELANJA</span>
        <b>${rupiah(receipt.total)}</b>
      </div>
      <div class="receipt-item-row" style="margin-top:6px">
        <span>Bayar (${escapeHtml(receipt.paymentMethod)})</span>
        <span>${rupiah(cashReceived)}</span>
      </div>
      <div class="receipt-item-row">
        <span>Kembalian</span>
        <b>${rupiah(change)}</b>
      </div>
      <hr class="receipt-divider">
      <div style="text-align:center;font-size:10px;color:#78716c;margin-top:10px">
        Terima kasih telah berbelanja di Urban Mart!<br>
        Barang yang sudah dibeli dapat ditukar maksimal 1x24 jam dengan struk fisik.
      </div>
    </div>
    <div class="modal-actions">
      <button class="button button-secondary" id="receipt-print"><i data-lucide="printer"></i> Cetak Struk</button>
      <button class="button button-primary" id="receipt-close">Selesai</button>
    </div>
  `);

  document.querySelector('#receipt-close')?.addEventListener('click', closeModal);
  document.querySelector('#receipt-modal-close')?.addEventListener('click', closeModal);
  document.querySelector('#receipt-print')?.addEventListener('click', () => printReceipt(receipt));
  if (window.lucide) window.lucide.createIcons();
}

function printReceipt(receipt) {
  const printWindow = window.open('', '_blank', 'width=420,height=680');
  if (!printWindow) return toast('Izinkan pop-up browser untuk mencetak struk.', true);

  const rows = receipt.items.map((item) => `
    <tr>
      <td style="padding:4px 0">${escapeHtml(item.name)} × ${item.quantity}</td>
      <td style="text-align:right;white-space:nowrap">${rupiah(item.subtotal)}</td>
    </tr>
  `).join('');

  printWindow.document.write(`
    <!doctype html>
    <html lang="id">
    <head>
      <meta charset="utf-8">
      <title>Struk ${escapeHtml(receipt.receiptNumber)}</title>
      <style>
        body { font-family: monospace; font-size: 13px; max-width: 340px; margin: 20px auto; color: #111; line-height: 1.4; }
        .center { text-align: center; }
        h1 { font-size: 18px; margin: 0; }
        p { font-size: 11px; margin: 3px 0; color: #444; }
        hr { border: 0; border-top: 1px dashed #666; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; font-size: 12px; margin: 3px 0; }
      </style>
    </head>
    <body>
      <div class="center">
        <h1>URBAN MART</h1>
        <p>Jl. Merdeka No. 45, Jakarta · Telp 021-5550101</p>
        <p>No: ${escapeHtml(receipt.receiptNumber)}<br>${new Date().toLocaleString('id-ID')}</p>
      </div>
      <hr>
      <table>${rows}</table>
      <hr>
      <div class="total">
        <span>TOTAL:</span>
        <span>${rupiah(receipt.total)}</span>
      </div>
      <div class="row">
        <span>Bayar (${escapeHtml(receipt.paymentMethod)}):</span>
        <span>${rupiah(receipt.cashReceived || receipt.total)}</span>
      </div>
      <div class="row">
        <span>Kembalian:</span>
        <span>${rupiah(receipt.changeAmount || 0)}</span>
      </div>
      <hr>
      <p class="center">Terima kasih atas kunjungan Anda!</p>
      <script>window.onload = () => window.print();</script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ============================================================================
// Modal System (Accessible & Clean)
// ============================================================================

function openModal(content) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
  document.body.append(backdrop);
}

function closeModal() {
  document.querySelector('#active-modal')?.remove();
}

// Global ESC key to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'F2') {
    e.preventDefault();
    switchPage('pos');
    document.querySelector('#pos-search')?.focus();
  }
});

// ============================================================================
// TAB 3: Pengadaan Barang (PO & Goods Receipt)
// ============================================================================

async function loadPurchases() {
  const rows = await api('/api/purchases');
  state.purchases = rows;
  const tbody = document.querySelector('#purchase-table');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((item) => {
    const isReceived = item.status_pembayaran === 'Diterima';
    const actionCell = isReceived
      ? '<span class="badge safe"><i data-lucide="check"></i> Stok Diterima</span>'
      : `<button class="action-button" data-receive-purchase="${item.id_pembelian}"><i data-lucide="package-check"></i> Terima Barang</button>`;
    
    return `
      <tr>
        <td><b>${escapeHtml(item.no_faktur)}</b></td>
        <td>${new Date(item.tanggal_pembelian).toLocaleDateString('id-ID')}</td>
        <td>${escapeHtml(item.nama_supplier)}</td>
        <td>${escapeHtml(item.nama_karyawan)}</td>
        <td>${item.jumlah_item} item</td>
        <td><b>${rupiah(item.total_harga)}</b></td>
        <td><span class="badge ${isReceived ? 'safe' : item.status_pembayaran === 'Lunas' ? 'safe' : 'low'}">${escapeHtml(item.status_pembayaran)}</span></td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="8" class="empty-state">Belum ada riwayat Purchase Order.</td></tr>';

  tbody.querySelectorAll('[data-receive-purchase]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.receivePurchase);
      if (!confirm('Konfirmasi penerimaan barang untuk PO ini? Saldo stok gudang akan otomatis bertambah.')) return;
      try {
        const res = await api(`/api/purchases/${id}/receive`, {
          method: 'POST',
          body: JSON.stringify({ warehouseId: 1 })
        });
        toast(`Barang faktur ${res.invoiceNumber} berhasil diterima dan ditambahkan ke stok.`);
        await Promise.all([loadPurchases(), loadDashboard(), loadProducts(), loadPosStock(), loadOpnameStock()]);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function openPurchaseModal() {
  if (!state.products.some((item) => item.aktif) || !state.suppliers.length) {
    return toast('Tambahkan produk dan supplier terlebih dahulu sebelum membuat PO.', true);
  }
  const supplierOptions = state.suppliers.map((item) => `<option value="${item.id_supplier}">${escapeHtml(item.nama_supplier)}</option>`).join('');
  const productOptions = state.products.filter((item) => item.aktif).map((item) =>
    `<option value="${item.id_produk}">${escapeHtml(item.nama_produk)} — ${rupiah(item.harga_beli)}</option>`).join('');
  const employeeOptions = state.references.employees.filter((item) => item.jabatan === 'Purchasing' || item.jabatan === 'Admin').map((item) =>
    `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.jabatan)})</option>`).join('');

  openModal(`
    <div class="modal-header">
      <h2>Buat Purchase Order (PO) Baru</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <form id="purchase-form">
      <div class="form-row">
        <label>Pemasok / Supplier<select name="supplierId">${supplierOptions}</select></label>
        <label>Petugas Purchasing<select name="employeeId">${employeeOptions}</select></label>
      </div>
      <label>Daftar Item Barang yang Dipesan</label>
      <div class="purchase-items" id="purchase-items"></div>
      <button type="button" class="text-button" id="add-purchase-item">+ Tambah Baris Item</button>
      <div class="modal-actions">
        <button type="button" class="button button-secondary" id="modal-cancel">Batal</button>
        <button class="button button-primary"><i data-lucide="send"></i> Simpan & Terbitkan PO</button>
      </div>
    </form>
  `);

  const addLine = () => {
    const row = document.createElement('div');
    row.className = 'purchase-item';
    row.innerHTML = `
      <select class="purchase-product">${productOptions}</select>
      <input class="purchase-quantity" type="number" min="1" value="10" placeholder="Qty">
      <input class="purchase-price" type="number" min="0" step="500" placeholder="Harga Beli">
      <button type="button" aria-label="Hapus baris" title="Hapus">×</button>
    `;
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
  document.querySelector('#modal-close-btn').addEventListener('click', closeModal);
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
      await api('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: Number(values.supplierId),
          employeeId: Number(values.employeeId),
          items
        })
      });
      closeModal();
      toast('Purchase Order berhasil diterbitkan.');
      await loadPurchases();
    } catch (error) { toast(error.message, true); }
  });

  if (window.lucide) window.lucide.createIcons();
}

// ============================================================================
// TAB 4: Retur Barang
// ============================================================================

async function loadReturns() {
  state.returns = await api('/api/returns');
  renderReturns();
}

function renderReturns() {
  const filterType = document.querySelector('#return-type-filter')?.value || '';
  const rows = state.returns.filter((item) => !filterType || item.jenis_retur === filterType);
  const tbody = document.querySelector('#return-table');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((item) => {
    const refCode = item.no_faktur || item.no_transaksi || '—';
    const typeBadge = item.jenis_retur === 'Dari Pelanggan' ? 'safe' : 'low';
    return `
      <tr>
        <td><b>${escapeHtml(item.no_retur)}</b></td>
        <td>${new Date(item.tanggal_retur).toLocaleDateString('id-ID')}</td>
        <td><span class="badge ${typeBadge}">${escapeHtml(item.jenis_retur)}</span></td>
        <td><span style="font-family:var(--font-mono);font-size:11px">${escapeHtml(refCode)}</span></td>
        <td>${escapeHtml(item.nama_gudang)}</td>
        <td>${escapeHtml(item.nama_karyawan)}</td>
        <td><b>${rupiah(item.total_nilai_retur)}</b></td>
        <td><span class="badge safe">${escapeHtml(item.status_retur)}</span></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="8" class="empty-state">Belum ada riwayat transaksi retur.</td></tr>';
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
    <div class="modal-header">
      <h2>Catat Transaksi Retur</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <form id="return-form">
      <div class="form-row">
        <label>Jenis Retur
          <select name="returnType" id="ret-modal-type">
            <option value="Ke Supplier">Ke Supplier (Pengembalian Barang Rusak/Expired)</option>
            <option value="Dari Pelanggan">Dari Pelanggan (Barang Dikembalikan Customer)</option>
          </select>
        </label>
        <label>Gudang<select name="warehouseId">${warehouseOptions}</select></label>
      </div>
      <div class="form-row">
        <label>Dokumen Referensi Asal
          <select name="referenceId" id="ret-modal-ref"></select>
        </label>
        <label>Petugas Penanggung Jawab
          <select name="employeeId">${employeeOptions}</select>
        </label>
      </div>
      <label>Daftar Item Retur</label>
      <div class="purchase-items" id="return-items"></div>
      <button type="button" class="text-button" id="add-return-item">+ Tambah item retur</button>
      <div class="modal-actions">
        <button type="button" class="button button-secondary" id="modal-cancel">Batal</button>
        <button class="button button-primary"><i data-lucide="check"></i> Simpan Transaksi Retur</button>
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
  document.querySelector('#modal-close-btn').addEventListener('click', closeModal);
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

  if (window.lucide) window.lucide.createIcons();
}

// ============================================================================
// TAB 5: Stock Opname (Audit Fisik)
// ============================================================================

async function loadOpnameStock() {
  const warehouseId = document.querySelector('#opname-warehouse')?.value;
  state.opnameStock = warehouseId
    ? await api(`/api/stock?warehouseId=${encodeURIComponent(warehouseId)}`)
    : [];
  renderOpnameRows();
}

function renderOpnameRows() {
  const tbody = document.querySelector('#opname-table');
  if (!tbody) return;

  tbody.innerHTML = state.opnameStock.length ? state.opnameStock.map((item) => `
    <tr data-opname-row="${item.id_produk}">
      <td>
        <div class="product-cell">
          <span class="product-thumb"><i data-lucide="package"></i></span>
          <div>
            <b>${escapeHtml(item.nama_produk)}</b>
            <small>${escapeHtml(item.kode_barcode)} · Satuan: ${escapeHtml(item.satuan)}</small>
          </div>
        </div>
      </td>
      <td><b>${item.jumlah_stok}</b> ${escapeHtml(item.satuan)}</td>
      <td>
        <input class="input-control physical-count" type="number" min="0" step="1" placeholder="Masukkan fisik..." data-product-id="${item.id_produk}" data-system="${item.jumlah_stok}">
      </td>
      <td class="difference zero" data-difference-for="${item.id_produk}">—</td>
    </tr>
  `).join('') : '<tr><td colspan="4" class="empty-state">Tidak ada data stok di gudang ini untuk diaudit.</td></tr>';

  tbody.querySelectorAll('.physical-count').forEach((input) => {
    input.addEventListener('input', () => {
      const difference = input.value === '' ? null : Number(input.value) - Number(input.dataset.system);
      const cell = document.querySelector(`[data-difference-for="${input.dataset.productId}"]`);
      if (cell) {
        cell.textContent = difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference}`;
        cell.className = `difference ${difference === null || difference === 0 ? 'zero' : difference > 0 ? 'positive' : 'negative'}`;
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function prefillOpnameWithSystem() {
  document.querySelectorAll('.physical-count').forEach((input) => {
    input.value = input.dataset.system;
    const cell = document.querySelector(`[data-difference-for="${input.dataset.productId}"]`);
    if (cell) {
      cell.textContent = '0 (Sesuai)';
      cell.className = 'difference zero';
    }
  });
  toast('Stok fisik diisi sesuai stok sistem. Anda dapat menyesuaikan item yang memiliki selisih fisik.');
}

async function saveOpname() {
  const items = [...document.querySelectorAll('.physical-count')]
    .filter((input) => input.value !== '')
    .map((input) => ({ productId: Number(input.dataset.productId), physical: Number(input.value) }));

  if (!items.length) return toast('Isi setidaknya satu jumlah stok fisik aktual.', true);

  try {
    const result = await api('/api/opname', {
      method: 'POST',
      body: JSON.stringify({
        warehouseId: Number(document.querySelector('#opname-warehouse').value),
        employeeId: Number(document.querySelector('#opname-employee').value),
        notes: document.querySelector('#opname-notes').value,
        items
      })
    });
    toast(`Opname ${result.opnameNumber} berhasil disimpan. Saldo stok telah disinkronkan via trigger.`);
    document.querySelector('#opname-notes').value = '';
    await Promise.all([loadDashboard(), loadOpnameStock()]);
  } catch (error) { toast(error.message, true); }
}

// ============================================================================
// TAB 6: Laporan & Analitik (Chart.js Integration)
// ============================================================================

async function loadReports() {
  const warehouse = document.querySelector('#movement-warehouse-filter')?.value || '';
  const [salesData, movementRows] = await Promise.all([
    api('/api/reports/sales'),
    api(`/api/reports/stock-movement${warehouse ? `?warehouseId=${encodeURIComponent(warehouse)}` : ''}`)
  ]);

  state.reports = { sales: salesData, movement: movementRows };
  const { summary, fastMoving, paymentBreakdown, dailySales } = salesData;

  // KPI Cards
  document.querySelector('#rep-omzet').textContent = rupiah(summary.total_omzet);
  document.querySelector('#rep-transaksi').textContent = Number(summary.total_transaksi).toLocaleString('id-ID');
  document.querySelector('#rep-avg').textContent = rupiah(summary.rata_rata_transaksi);
  document.querySelector('#rep-top-product').textContent = fastMoving.length
    ? `${fastMoving[0].nama_produk} (${fastMoving[0].total_terjual} ${fastMoving[0].satuan})`
    : '—';

  // Fast Moving Table with Medals
  document.querySelector('#fast-moving-table').innerHTML = fastMoving.length ? fastMoving.map((item, index) => {
    const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-other';
    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
    return `
      <tr>
        <td><span class="rank-badge ${rankClass}">${rankIcon}</span></td>
        <td>
          <div class="product-cell">
            <span class="product-thumb"><i data-lucide="flame"></i></span>
            <b>${escapeHtml(item.nama_produk)}</b>
          </div>
        </td>
        <td><span style="font-family:var(--font-mono)">${escapeHtml(item.barcode)}</span></td>
        <td>${escapeHtml(item.nama_kategori)}</td>
        <td><b>${item.total_terjual}</b> ${escapeHtml(item.satuan)}</td>
        <td><b>${rupiah(item.total_pendapatan)}</b></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="6" class="empty-state">Belum ada transaksi penjualan produk.</td></tr>';

  // Stock Movement Audit Matrix
  document.querySelector('#stock-movement-table').innerHTML = movementRows.length ? movementRows.map((item) => `
    <tr>
      <td>
        <div class="product-cell">
          <span class="product-thumb"><i data-lucide="package"></i></span>
          <b>${escapeHtml(item.nama_produk)}</b>
        </div>
      </td>
      <td>${escapeHtml(item.nama_gudang)}</td>
      <td><span class="stock-number">${item.stok_saat_ini}</span> ${escapeHtml(item.satuan)}</td>
      <td style="color:var(--emerald-600);font-weight:600">+${item.total_masuk_pengadaan}</td>
      <td style="color:var(--emerald-600);font-weight:600">+${item.total_masuk_retur}</td>
      <td style="color:var(--rose-600);font-weight:600">-${item.total_keluar_penjualan}</td>
      <td style="color:var(--rose-600);font-weight:600">-${item.total_keluar_retur}</td>
      <td class="difference ${item.total_penyesuaian_opname > 0 ? 'positive' : item.total_penyesuaian_opname < 0 ? 'negative' : 'zero'}">
        ${item.total_penyesuaian_opname > 0 ? '+' : ''}${item.total_penyesuaian_opname}
      </td>
      <td>${statusBadge(item.status_stok)}</td>
    </tr>
  `).join('') : '<tr><td colspan="9" class="empty-state">Data kartu mutasi persediaan belum tersedia.</td></tr>';

  // Render Charts
  renderCharts(dailySales, paymentBreakdown);
  if (window.lucide) window.lucide.createIcons();
}

function renderCharts(dailySales, paymentBreakdown) {
  if (typeof Chart === 'undefined') return;

  // Chart 1: Daily Sales Trend (Line Chart)
  const salesCanvas = document.querySelector('#sales-trend-chart');
  if (salesCanvas) {
    if (state.charts.salesTrend) state.charts.salesTrend.destroy();

    const sortedDaily = [...(dailySales || [])].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
    const labels = sortedDaily.map((d) => {
      const parts = d.tanggal.split('-');
      return `${parts[2]}/${parts[1]}`;
    });
    const dataValues = sortedDaily.map((d) => Number(d.total_omzet));

    const ctx = salesCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.28)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.00)');

    state.charts.salesTrend = new Chart(salesCanvas, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Hari Ini'],
        datasets: [{
          label: 'Omzet Harian (Rp)',
          data: dataValues.length ? dataValues : [0],
          borderColor: '#4f46e5',
          backgroundColor: gradient,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#4f46e5',
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` Omzet: ${rupiah(item.raw)}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (val) => `${Number(val) / 1000}k`,
              font: { family: 'DM Sans', size: 10 }
            },
            grid: { color: '#f1f5f9' }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'DM Sans', size: 10 } }
          }
        }
      }
    });
  }

  // Chart 2: Payment Method Breakdown (Doughnut Chart)
  const paymentCanvas = document.querySelector('#payment-chart');
  if (paymentCanvas) {
    if (state.charts.paymentBreakdown) state.charts.paymentBreakdown.destroy();

    const labels = (paymentBreakdown || []).map((p) => p.metode_pembayaran);
    const dataValues = (paymentBreakdown || []).map((p) => Number(p.total_nominal));
    const colors = ['#4f46e5', '#10b981', '#06b6d4', '#f59e0b'];

    state.charts.paymentBreakdown = new Chart(paymentCanvas, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Belum Ada'],
        datasets: [{
          data: dataValues.length ? dataValues : [1],
          backgroundColor: labels.length ? colors.slice(0, labels.length) : ['#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'DM Sans', size: 11 }, padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${rupiah(item.raw)}`
            }
          }
        }
      }
    });
  }
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
  let csv = 'REKAP PENJUALAN MINIMARKET (LAPORAN EKSEKUTIF)\r\n';
  csv += `Total Transaksi Kasir,${summary.total_transaksi}\r\n`;
  csv += `Total Omzet Kotor,${summary.total_omzet}\r\n`;
  csv += `Rata-Rata Belanja (AOV),${summary.rata_rata_transaksi}\r\n\r\n`;

  csv += 'METODE PEMBAYARAN,JUMLAH TRANSAKSI,TOTAL NOMINAL\r\n';
  paymentBreakdown.forEach((p) => {
    csv += `"${p.metode_pembayaran}",${p.jumlah_transaksi},${p.total_nominal}\r\n`;
  });

  csv += '\r\nTOP PRODUK TERLARIS (FAST MOVING),BARCODE EAN-13,KATEGORI,TOTAL UNIT TERJUAL,TOTAL PENDAPATAN\r\n';
  fastMoving.forEach((p) => {
    csv += `"${p.nama_produk}","${p.barcode}","${p.nama_kategori}",${p.total_terjual},${p.total_pendapatan}\r\n`;
  });

  downloadCSV(`Laporan_Penjualan_Minimarket_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function exportMovementCSV() {
  if (!state.reports?.movement?.length) return toast('Data mutasi stok belum siap diekspor.', true);
  let csv = 'KARTU MUTASI STOK PERSPEKTIF AUDIT (STOCK MOVEMENT AUDIT)\r\n';
  csv += 'NAMA PRODUK,BARCODE,LOKASI GUDANG,SALDO STOK,MASUK PENGADAAN (PO),MASUK RETUR PELANGGAN,KELUAR KASIR POS,KELUAR RETUR SUPPLIER,PENYESUAIAN OPNAME,STATUS STOK\r\n';
  state.reports.movement.forEach((m) => {
    csv += `"${m.nama_produk}","${m.barcode}","${m.nama_gudang}",${m.stok_saat_ini},${m.total_masuk_pengadaan},${m.total_masuk_retur},${m.total_keluar_penjualan},${m.total_keluar_retur},${m.total_penyesuaian_opname},"${m.status_stok}"\r\n`;
  });

  downloadCSV(`Kartu_Mutasi_Stok_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

// ============================================================================
// TAB 7 & 8: Master Data (Produk & Supplier)
// ============================================================================

async function loadProducts() {
  state.products = await api('/api/masters/products');
  renderProducts();
  renderPosProducts();
  renderOpnameRows();
}

function renderProducts() {
  const term = document.querySelector('#product-master-search')?.value.toLowerCase().trim() || '';
  const rows = state.products.filter((item) => item.aktif &&
    (item.nama_produk.toLowerCase().includes(term) || item.kode_barcode.toLowerCase().includes(term) || item.nama_kategori.toLowerCase().includes(term)));
  const tbody = document.querySelector('#product-table');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td>
        <div class="product-cell">
          <span class="product-thumb"><i data-lucide="package"></i></span>
          <div>
            <b>${escapeHtml(item.nama_produk)}</b>
            <small>Satuan: ${escapeHtml(item.satuan)}</small>
          </div>
        </div>
      </td>
      <td><span style="font-family:var(--font-mono)">${escapeHtml(item.kode_barcode)}</span></td>
      <td><span class="badge neutral">${escapeHtml(item.nama_kategori)}</span></td>
      <td>${rupiah(item.harga_beli)}</td>
      <td><b>${rupiah(item.harga_jual)}</b></td>
      <td>${item.stok_minimum} ${escapeHtml(item.satuan)}</td>
      <td>
        <div class="table-action">
          <button class="action-button" data-edit-product="${item.id_produk}"><i data-lucide="edit"></i> Edit</button>
          <button class="action-button danger" data-delete-product="${item.id_produk}"><i data-lucide="trash-2"></i> Nonaktifkan</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-state">Belum ada produk aktif yang cocok.</td></tr>';

  tbody.querySelectorAll('[data-edit-product]').forEach((button) => {
    button.addEventListener('click', () => openProductModal(Number(button.dataset.editProduct)));
  });
  tbody.querySelectorAll('[data-delete-product]').forEach((button) => {
    button.addEventListener('click', () => deactivateProduct(Number(button.dataset.deleteProduct)));
  });

  if (window.lucide) window.lucide.createIcons();
}

function openProductModal(id = null) {
  const item = state.products.find((product) => product.id_produk === id);
  const categories = state.references.categories.map((category) =>
    `<option value="${category.id}" ${item?.id_kategori === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');

  openModal(`
    <div class="modal-header">
      <h2>${item ? 'Edit Data Produk' : 'Tambah Produk Baru'}</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <form id="product-form">
      <label>Barcode EAN-13 (13 Digit Standar GS1)<input name="barcode" required value="${escapeHtml(item?.kode_barcode || '')}" placeholder="Contoh: 8991001000019"></label>
      <label>Nama Produk Lengkap<input name="name" required value="${escapeHtml(item?.nama_produk || '')}" placeholder="Contoh: Biskuit Cokelat 150g"></label>
      <label>Kategori Produk<select name="categoryId" required>${categories}</select></label>
      <div class="form-row">
        <label>Harga Beli (Modal)<input name="purchasePrice" type="number" min="0" step="100" required value="${item?.harga_beli ?? 0}"></label>
        <label>Harga Jual (Konsumen)<input name="salePrice" type="number" min="0" step="100" required value="${item?.harga_jual ?? ''}"></label>
      </div>
      <div class="form-row">
        <label>Satuan Barang<input name="unit" required value="${escapeHtml(item?.satuan || 'pcs')}" placeholder="pcs / botol / pack"></label>
        <label>Ambang Batas Stok Minimum<input name="minimumStock" type="number" min="0" required value="${item?.stok_minimum ?? 5}"></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="button button-secondary" id="modal-cancel">Batal</button>
        <button class="button button-primary"><i data-lucide="save"></i> Simpan Data Produk</button>
      </div>
    </form>
  `);

  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#modal-close-btn').addEventListener('click', closeModal);

  document.querySelector('#product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      ...values,
      categoryId: Number(values.categoryId),
      purchasePrice: Number(values.purchasePrice),
      salePrice: Number(values.salePrice),
      minimumStock: Number(values.minimumStock),
      active: item?.aktif ?? true
    };
    try {
      await api(item ? `/api/masters/products/${id}` : '/api/masters/products', {
        method: item ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      closeModal();
      toast('Data produk berhasil disimpan.');
      await Promise.all([loadProducts(), loadDashboard(), loadPosStock(), loadOpnameStock()]);
    } catch (error) { toast(error.message, true); }
  });

  if (window.lucide) window.lucide.createIcons();
}

async function deactivateProduct(id) {
  if (!confirm('Nonaktifkan produk ini dari sistem? Transaksi terdahulu tetap dipertahankan.')) return;
  try {
    await api(`/api/masters/products/${id}`, { method: 'DELETE' });
    toast('Produk berhasil dinonaktifkan.');
    await Promise.all([loadProducts(), loadDashboard(), loadPosStock(), loadOpnameStock()]);
  } catch (error) { toast(error.message, true); }
}

async function loadSuppliers() {
  state.suppliers = await api('/api/masters/suppliers');
  renderSuppliers();
}

function renderSuppliers() {
  const term = document.querySelector('#supplier-master-search')?.value.toLowerCase().trim() || '';
  const rows = state.suppliers.filter((item) =>
    item.nama_supplier.toLowerCase().includes(term) || (item.kontak_person || '').toLowerCase().includes(term)
  );
  const tbody = document.querySelector('#supplier-table');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td>
        <div class="product-cell">
          <span class="product-thumb"><i data-lucide="building"></i></span>
          <b>${escapeHtml(item.nama_supplier)}</b>
        </div>
      </td>
      <td>${escapeHtml(item.kontak_person || '—')}</td>
      <td>${escapeHtml(item.no_telepon || '—')}</td>
      <td><span style="font-family:var(--font-mono);font-size:11px">${escapeHtml(item.email || '—')}</span></td>
      <td>${escapeHtml(item.alamat || '—')}</td>
      <td>
        <div class="table-action">
          <button class="action-button" data-edit-supplier="${item.id_supplier}"><i data-lucide="edit"></i> Edit</button>
          <button class="action-button danger" data-delete-supplier="${item.id_supplier}"><i data-lucide="trash-2"></i> Hapus</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty-state">Belum ada supplier yang cocok.</td></tr>';

  tbody.querySelectorAll('[data-edit-supplier]').forEach((button) => {
    button.addEventListener('click', () => openSupplierModal(Number(button.dataset.editSupplier)));
  });
  tbody.querySelectorAll('[data-delete-supplier]').forEach((button) => {
    button.addEventListener('click', () => deleteSupplier(Number(button.dataset.deleteSupplier)));
  });

  if (window.lucide) window.lucide.createIcons();
}

function openSupplierModal(id = null) {
  const supplier = state.suppliers.find((item) => item.id_supplier === id);

  openModal(`
    <div class="modal-header">
      <h2>${supplier ? 'Edit Data Supplier' : 'Tambah Mitra Supplier Baru'}</h2>
      <button class="modal-close" id="modal-close-btn" aria-label="Tutup"><i data-lucide="x"></i></button>
    </div>
    <form id="supplier-form">
      <label>Nama Perusahaan Supplier<input name="name" required value="${escapeHtml(supplier?.nama_supplier || '')}" placeholder="PT / CV Nama Perusahaan"></label>
      <label>Narahubung (PIC Sales)<input name="contactPerson" value="${escapeHtml(supplier?.kontak_person || '')}" placeholder="Nama PIC"></label>
      <div class="form-row">
        <label>Nomor Telepon Operasional<input name="phone" value="${escapeHtml(supplier?.no_telepon || '')}" placeholder="021-xxxxxx"></label>
        <label>Email Resmi Korespondensi PO<input name="email" type="email" value="${escapeHtml(supplier?.email || '')}" placeholder="sales@perusahaan.com"></label>
      </div>
      <label>Alamat Kantor / Gudang Supplier<textarea name="address" rows="3" placeholder="Alamat lengkap supplier...">${escapeHtml(supplier?.alamat || '')}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="button button-secondary" id="modal-cancel">Batal</button>
        <button class="button button-primary"><i data-lucide="save"></i> Simpan Data Supplier</button>
      </div>
    </form>
  `);

  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#modal-close-btn').addEventListener('click', closeModal);

  document.querySelector('#supplier-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(supplier ? `/api/masters/suppliers/${id}` : '/api/masters/suppliers', {
        method: supplier ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      closeModal();
      toast('Data supplier berhasil disimpan.');
      await loadSuppliers();
    } catch (error) { toast(error.message, true); }
  });

  if (window.lucide) window.lucide.createIcons();
}

async function deleteSupplier(id) {
  if (!confirm('Hapus supplier ini? Supplier yang telah digunakan dalam transaksi pengadaan tidak dapat dihapus.')) return;
  try {
    await api(`/api/masters/suppliers/${id}`, { method: 'DELETE' });
    toast('Supplier berhasil dihapus.');
    await loadSuppliers();
  } catch (error) { toast(error.message, true); }
}

// ============================================================================
// Page Navigation & Event Binding
// ============================================================================

function switchPage(name) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === name));

  const active = document.querySelector(`.nav-link[data-page="${name}"]`);
  const breadcrumbCurrent = document.querySelector('#breadcrumb-current');
  if (breadcrumbCurrent && active) {
    breadcrumbCurrent.textContent = active.textContent.trim();
  }

  document.querySelector('.sidebar')?.classList.remove('open');

  if (name === 'dashboard') loadDashboard().catch((error) => toast(error.message, true));
  if (name === 'pos') loadPosStock().catch((error) => toast(error.message, true));
  if (name === 'purchases') loadPurchases().catch((error) => toast(error.message, true));
  if (name === 'returns') loadReturns().catch((error) => toast(error.message, true));
  if (name === 'opname') loadOpnameStock().catch((error) => toast(error.message, true));
  if (name === 'reports') loadReports().catch((error) => toast(error.message, true));
  if (name === 'products') loadProducts().catch((error) => toast(error.message, true));
  if (name === 'suppliers') loadSuppliers().catch((error) => toast(error.message, true));
}

// Global Event Listeners
document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
document.querySelectorAll('[data-goto]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.goto)));
document.querySelector('#mobile-menu')?.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('open'));

document.querySelector('#refresh-button')?.addEventListener('click', () => {
  Promise.all([loadDashboard(), loadProducts(), loadSuppliers(), loadPurchases()])
    .then(() => toast('Seluruh data berhasil disegarkan.'))
    .catch((error) => toast(error.message, true));
});

document.querySelector('#stock-refresh')?.addEventListener('click', () => loadDashboard().catch((error) => toast(error.message, true)));
document.querySelector('#warehouse-filter')?.addEventListener('change', () => loadDashboard().catch((error) => toast(error.message, true)));

document.querySelector('#pos-warehouse')?.addEventListener('change', () => {
  state.cart.clear();
  renderCart();
  loadPosStock().catch((error) => toast(error.message, true));
});

document.querySelector('#opname-warehouse')?.addEventListener('change', () => loadOpnameStock().catch((error) => toast(error.message, true)));
document.querySelector('#stock-search')?.addEventListener('input', renderStock);
document.querySelector('#pos-search')?.addEventListener('input', renderPosProducts);

// Barcode scanner keydown listener on POS search: Enter adds product directly!
document.querySelector('#pos-search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const barcodeInput = e.target.value.trim();
    if (!barcodeInput) return;

    const matchedProduct = state.products.find((p) => p.aktif && (p.kode_barcode === barcodeInput || p.barcode === barcodeInput));
    if (matchedProduct) {
      changeCart(matchedProduct.id_produk, 1);
      e.target.value = '';
      renderPosProducts();
      toast(`+1 ${matchedProduct.nama_produk} ditambahkan via barcode!`);
    } else {
      const filtered = state.products.filter((p) => p.aktif && p.nama_produk.toLowerCase().includes(barcodeInput.toLowerCase()));
      if (filtered.length === 1) {
        changeCart(filtered[0].id_produk, 1);
        e.target.value = '';
        renderPosProducts();
        toast(`+1 ${filtered[0].nama_produk} ditambahkan!`);
      }
    }
  }
});

// Category filter chips in POS
document.querySelectorAll('#pos-category-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#pos-category-chips .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.selectedPosCategory = chip.dataset.category || '';
    renderPosProducts();
  });
});

// Quick cash chips & calculations
document.querySelector('#cash-exact-btn')?.addEventListener('click', () => {
  const total = calculateCartTotal();
  const input = document.querySelector('#pos-cash-input');
  if (input) {
    input.value = total;
    updateChangeCalculation();
  }
});

document.querySelectorAll('.cash-chip[data-cash]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const amount = Number(chip.dataset.cash);
    const input = document.querySelector('#pos-cash-input');
    if (input) {
      input.value = amount;
      updateChangeCalculation();
    }
  });
});

document.querySelector('#pos-cash-input')?.addEventListener('input', updateChangeCalculation);
document.querySelector('#payment-method')?.addEventListener('change', updateChangeCalculation);

document.querySelector('#clear-cart')?.addEventListener('click', () => {
  state.cart.clear();
  if (document.querySelector('#pos-cash-input')) document.querySelector('#pos-cash-input').value = '';
  renderCart();
  renderPosProducts();
});

document.querySelector('#checkout-button')?.addEventListener('click', checkout);
document.querySelector('#save-opname')?.addEventListener('click', saveOpname);
document.querySelector('#opname-prefill')?.addEventListener('click', prefillOpnameWithSystem);

document.querySelector('#new-product')?.addEventListener('click', () => openProductModal());
document.querySelector('#product-master-search')?.addEventListener('input', renderProducts);
document.querySelector('#new-supplier')?.addEventListener('click', () => openSupplierModal());
document.querySelector('#supplier-master-search')?.addEventListener('input', renderSuppliers);

document.querySelector('#new-purchase')?.addEventListener('click', openPurchaseModal);
document.querySelector('#new-return')?.addEventListener('click', openReturnModal);
document.querySelector('#return-type-filter')?.addEventListener('change', renderReturns);
document.querySelector('#movement-warehouse-filter')?.addEventListener('change', loadReports);

document.querySelector('#export-sales-csv')?.addEventListener('click', exportSalesCSV);
document.querySelector('#export-movement-csv')?.addEventListener('click', exportMovementCSV);
document.querySelector('#print-reports')?.addEventListener('click', () => window.print());

// ============================================================================
// Initialization Routine
// ============================================================================

(async function initialize() {
  try {
    startLiveClock();
    const dateEyebrow = document.querySelector('#dashboard-date-eyebrow');
    if (dateEyebrow) {
      dateEyebrow.textContent = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
      }).format(new Date()).toUpperCase();
    }

    await loadReferences();
    await Promise.all([
      loadDashboard(),
      loadProducts(),
      loadSuppliers(),
      loadOpnameStock(),
      loadPosStock()
    ]);
    renderCart();

    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    toast(`Gagal memuat inisialisasi aplikasi: ${error.message}`, true);
  }
})();

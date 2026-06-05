function renderSales() {
    const productOptions = inventory.map(p => `<option value="${p.id}" data-price="${p.priceKg}">${p.name} (${p.stockKg} kg available) - KES ${p.priceKg}/kg</option>`).join('');
    const today = new Date().toISOString().split('T')[0];
    
    return `<div class="sales-panel"><div class="sales-card"><h3>📦 Total KG Today</h3><div class="amount">${currentDaySales.totalKg} kg</div></div><div class="sales-card"><h3>💰 Cash Today</h3><div class="amount">KES ${currentDaySales.cashAmount.toLocaleString()}</div></div><div class="sales-card"><h3>📱 M-Pesa Today</h3><div class="amount">KES ${currentDaySales.mpesaAmount.toLocaleString()}</div></div></div>
    
    <div class="card">
        <div class="card-header"><h2>🛒 Record Sale by Product</h2></div>
        <div class="form-group">
            <label>🥩 Select Product</label>
            <select id="saleProduct" class="product-select" onchange="onProductChange()">
                <option value="">-- Select Product --</option>
                ${productOptions}
            </select>
        </div>
        <div class="form-group">
            <label>💵 Cash Amount (KES)</label>
            <input type="number" id="dailyCash" placeholder="Enter cash amount" oninput="autoCalculateKg()">
        </div>
        <div class="form-group">
            <label>📲 M-Pesa Amount (KES)</label>
            <input type="number" id="dailyMpesa" placeholder="Enter M-Pesa amount" oninput="autoCalculateKg()">
        </div>
        <div class="form-group">
            <label>📦 Quantity Sold (kg) - Auto Calculated</label>
            <input type="number" id="dailyKg" step="0.1" placeholder="Auto-calculated" readonly style="background-color:#f3f4f6; cursor:not-allowed;">
            <div class="calc-note"><i class="fas fa-calculator"></i> KG is automatically calculated from Cash + M-Pesa divided by product price</div>
        </div>
        <div class="action-buttons">
            <button class="btn btn-success" onclick="updateDailySales()"><i class="fas fa-plus-circle"></i> Add Sale</button>
            <button class="btn btn-warning" onclick="closeDay()"><i class="fas fa-lock"></i> Close Day</button>
            <button class="btn" onclick="startNewDay()"><i class="fas fa-sun"></i> Start New Day</button>
        </div>
    </div>
    
    ${currentDaySales.salesByProduct && Object.keys(currentDaySales.salesByProduct).length > 0 ? `
    <div class="card">
        <div class="card-header"><h2>📊 Today's Sales by Product</h2></div>
        <div class="table-container">
            <table class="data-table">
                <thead><tr><th>Product</th><th>Quantity (kg)</th><th>Revenue (KES)</th><th>Action</th></tr></thead>
                <tbody>
                    ${Object.entries(currentDaySales.salesByProduct).map(([product, kg]) => {
                        const productInfo = inventory.find(p => p.name === product);
                        const pricePerKg = productInfo?.priceKg || 0;
                        const revenue = kg * pricePerKg;
                        return `<tr>
                            <td style="padding:8px">${product}</td>
                            <td style="padding:8px">${parseFloat(kg).toFixed(2)} kg</td>
                            <td style="padding:8px">KES ${revenue.toLocaleString()} (${pricePerKg}/kg)</td>
                            <td style="padding:8px"><button class="btn-delete" onclick="deleteSaleEntry('${product}', ${kg})">Delete</button></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            <div class="calc-note" style="padding:10px; text-align:right;"><i class="fas fa-info-circle"></i> Revenue = Quantity × Price per kg</div>
        </div>
    </div>
    ` : ''}
    
    <div class="alert-info"><i class="fas fa-info-circle"></i> <strong>Date:</strong> ${currentDaySales.date} | <strong>Status:</strong> ${currentDaySales.isClosed ? '🔒 Closed' : '🟢 Open'}${currentDaySales.isClosed ? '<br>To record new sales, click "Start New Day"' : ''}</div>`;
}
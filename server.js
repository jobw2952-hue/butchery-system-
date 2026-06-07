window.closeDay = async () => {
    const today = selectedSalesDate;
    if (currentDaySales.isClosed) {
        alert('This day is already closed!');
        return;
    }
    if (currentDaySales.totalKg === 0 && currentDaySales.cashAmount === 0 && currentDaySales.mpesaAmount === 0) {
        alert('No sales to close. Please add sales first.');
        return;
    }
    
    const total = currentDaySales.cashAmount + currentDaySales.mpesaAmount;
    let salesSummary = '';
    if (currentDaySales.salesByProduct && Object.keys(currentDaySales.salesByProduct).length > 0) {
        salesSummary = '\n\n📊 Sales Summary:';
        for (const [product, kg] of Object.entries(currentDaySales.salesByProduct)) {
            const productInfo = inventory.find(p => p.name === product);
            const revenue = kg * (productInfo?.priceKg || 0);
            salesSummary += `\n   • ${product}: ${roundToTwo(kg)} kg = KES ${roundToTwo(revenue).toLocaleString()}`;
        }
    }
    
    if (confirm(`🔒 CLOSE DAY: ${today}\n\n📦 Total KG: ${roundToTwo(currentDaySales.totalKg)} kg\n💰 Cash: KES ${currentDaySales.cashAmount.toLocaleString()}\n📱 M-Pesa: KES ${currentDaySales.mpesaAmount.toLocaleString()}\n💵 Total Revenue: KES ${roundToTwo(total).toLocaleString()}${salesSummary}\n\n⚠️ Once closed, you cannot add more sales for this day.\n\nDo you want to close this day?`)) {
        const result = await apiCall('/api/close-day', 'POST', { date: today });
        if (result) {
            await loadSalesForDate(today);
            await loadAllData();
            renderApp();
            alert(`✅ Day ${today} closed successfully!`);
        } else {
            alert('Failed to close day.');
        }
    }
};
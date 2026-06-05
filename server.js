// ========== RESET ALL DATA - SET STOCK TO 0 ==========
app.post('/api/reset-all', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get user's full name for logging
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        
        db.serialize(() => {
            // Clear daily closings
            db.run("DELETE FROM daily_closings");
            
            // Clear expenses
            db.run("DELETE FROM expenses");
            
            // Clear activity logs (but keep this reset log)
            db.run("DELETE FROM activity_logs");
            
            // Reset current day sales to ZERO
            db.run("DELETE FROM current_day_sales");
            db.run(`INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed) VALUES (?, 0, 0, 0, 0)`, [today]);
            
            // IMPORTANT: Set stock to 0, DO NOT delete products
            db.run("UPDATE inventory SET stockKg = 0", (err) => {
                if (err) {
                    console.error('Error resetting inventory:', err);
                } else {
                    console.log('✅ Inventory stock set to 0 for all products');
                }
            });
            
            // Log the reset action
            db.run(`INSERT INTO activity_logs (timestamp, user, userRole, action, details) VALUES (?, ?, ?, ?, ?)`,
                [new Date().toLocaleString(), userName, req.user.role, 'System Reset', 'All data was reset - Stock set to 0, products preserved'],
                (err) => {
                    if (err) console.error('Error logging reset:', err);
                    console.log('✅ All data reset to zero by:', userName);
                    res.json({ message: 'All data has been reset to zero. Stock quantities are now 0. Products preserved.' });
                });
        });
    });
});
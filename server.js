const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'butchery_secret_key_2024';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create database connection
const db = new sqlite3.Database('./butchery.db');

function roundToTwo(num) {
    if (isNaN(num)) return 0;
    return Math.round(num * 100) / 100;
}

function getLocalTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-US', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function addActivityLog(userName, userRole, action, details) {
    const timestamp = getLocalTimestamp();
    db.run(`INSERT INTO activity_logs (timestamp, user, userRole, action, details) VALUES (?, ?, ?, ?, ?)`,
        [timestamp, userName, userRole, action, details]);
}

// Initialize database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        fullName TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        isActive INTEGER DEFAULT 1,
        createdAt TEXT,
        lastLogin TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        animal TEXT NOT NULL,
        stockKg REAL NOT NULL,
        priceKg REAL NOT NULL,
        costKg REAL NOT NULL,
        lowStockAlert REAL NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS daily_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        totalKg REAL NOT NULL,
        cashAmount REAL NOT NULL,
        mpesaAmount REAL NOT NULL,
        totalRevenue REAL NOT NULL,
        closedBy TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS current_day_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        totalKg REAL DEFAULT 0,
        cashAmount REAL DEFAULT 0,
        mpesaAmount REAL DEFAULT 0,
        isClosed INTEGER DEFAULT 0,
        salesByProduct TEXT DEFAULT '{}'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user TEXT NOT NULL,
        userRole TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT
    )`);
    
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync('admin123', salt);
    
    db.get("SELECT * FROM users WHERE username = 'superadmin'", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role, fullName, email, phone, isActive, createdAt) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['superadmin', hashedPassword, 'super_admin', 'Super Admin', 'super@butchery.com', '0712345678', 1, getLocalTimestamp()]);
            console.log('✅ Super Admin user created');
        }
    });
    
    db.get("SELECT * FROM users WHERE username = 'admin1'", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role, fullName, email, phone, isActive, createdAt) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin1', hashedPassword, 'admin', 'John Admin', 'john@butchery.com', '0723456789', 1, getLocalTimestamp()]);
            console.log('✅ Admin user created');
        }
    });
    
    db.get("SELECT COUNT(*) as count FROM inventory", (err, row) => {
        if (row && row.count === 0) {
            const defaultInventory = [
                ['Cow Sirloin', 'Cow', 50, 850, 560, 10],
                ['Goat Leg', 'Goat', 25, 950, 640, 8],
                ['Chicken Whole', 'Chicken', 40, 550, 370, 12],
                ['Fresh Liver', 'Liver', 15, 450, 300, 5],
                ['Matumbo (Tripe)', 'Cow', 20, 380, 250, 6]
            ];
            defaultInventory.forEach(item => {
                db.run(`INSERT INTO inventory (name, animal, stockKg, priceKg, costKg, lowStockAlert) VALUES (?, ?, ?, ?, ?, ?)`, item);
            });
            console.log('✅ Default inventory created');
        }
    });
    
    const today = new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ?", [today], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [today]);
            console.log('✅ Current day sales initialized');
        }
    });
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// ========== LOGIN ==========
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN] Attempt: ${username}`);
    
    db.get("SELECT * FROM users WHERE username = ? AND isActive = 1", [username], (err, user) => {
        if (err || !user) {
            console.log(`[LOGIN] User not found: ${username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (!bcrypt.compareSync(password, user.password)) {
            console.log(`[LOGIN] Invalid password for: ${username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        db.run("UPDATE users SET lastLogin = ? WHERE id = ?", [getLocalTimestamp(), user.id]);
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, fullName: user.fullName }, SECRET_KEY, { expiresIn: '24h' });
        
        console.log(`[LOGIN] Success: ${username} (${user.role})`);
        addActivityLog(user.fullName, user.role, 'Login', `${user.fullName} logged in`);
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone
            }
        });
    });
});

app.get('/api/me', authenticateToken, (req, res) => {
    db.get("SELECT id, username, role, fullName, email, phone FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

// ========== INVENTORY ==========
app.get('/api/inventory', authenticateToken, (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY id", (err, inventory) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(inventory || []);
    });
});

app.post('/api/inventory', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    db.run(`INSERT INTO inventory (name, animal, stockKg, priceKg, costKg, lowStockAlert) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, animal, stockKg, priceKg, costKg || priceKg * 0.7, lowStockAlert || 10],
        function(err) {
            if (err) return res.status(400).json({ error: 'Failed to add product' });
            res.json({ id: this.lastID, message: 'Product added' });
        });
});

// UPDATE INVENTORY - ALLOWS BOTH SUPER_ADMIN AND ADMIN
app.put('/api/inventory/:id', authenticateToken, (req, res) => {
    console.log(`[INVENTORY] Update by ${req.user.role}: ${req.user.username}`);
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    db.run(`UPDATE inventory SET name = ?, animal = ?, stockKg = ?, priceKg = ?, costKg = ?, lowStockAlert = ? WHERE id = ?`,
        [name, animal, stockKg, priceKg, costKg, lowStockAlert, req.params.id],
        (err) => {
            if (err) return res.status(400).json({ error: 'Update failed' });
            res.json({ message: 'Product updated' });
        });
});

app.delete('/api/inventory/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM inventory WHERE id = ?", [req.params.id], (err) => {
        res.json({ message: 'Product deleted' });
    });
});

// ========== SALES ==========
app.get('/api/sales-by-date', authenticateToken, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ?", [date], (err, sales) => {
        if (!sales) {
            db.run("INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')", [date]);
            res.json({ date: date, totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} });
        } else {
            let salesByProduct = {};
            try { salesByProduct = JSON.parse(sales.salesByProduct || '{}'); } catch(e) {}
            res.json({ 
                ...sales, 
                isClosed: sales.isClosed === 1,
                salesByProduct: salesByProduct
            });
        }
    });
});

app.get('/api/current-sales', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ?", [today], (err, sales) => {
        if (!sales) {
            db.run("INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')", [today]);
            res.json({ date: today, totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} });
        } else {
            let salesByProduct = {};
            try { salesByProduct = JSON.parse(sales.salesByProduct || '{}'); } catch(e) {}
            res.json({ 
                ...sales, 
                isClosed: sales.isClosed === 1,
                salesByProduct: salesByProduct
            });
        }
    });
});

// ADD SALE - NO ROLE RESTRICTION
app.post('/api/current-sales', authenticateToken, (req, res) => {
    let { kg, cash, mpesa, productId, productName, date } = req.body;
    const saleDate = date || new Date().toISOString().split('T')[0];
    
    console.log(`[SALE] ${req.user.role} (${req.user.username}) adding sale: ${kg}kg of ${productName} on ${saleDate}`);
    
    db.get("SELECT isClosed FROM current_day_sales WHERE date = ?", [saleDate], (err, dayStatus) => {
        if (dayStatus && dayStatus.isClosed === 1) {
            console.log(`[SALE] Failed - day is closed`);
            return res.status(400).json({ error: 'This day is already closed' });
        }
        
        db.get("SELECT salesByProduct, totalKg, cashAmount, mpesaAmount FROM current_day_sales WHERE date = ?", [saleDate], (err, current) => {
            let salesByProduct = {};
            let currentTotalKg = 0, currentCash = 0, currentMpesa = 0;
            if (current) {
                try { salesByProduct = JSON.parse(current.salesByProduct || '{}'); } catch(e) {}
                currentTotalKg = current.totalKg || 0;
                currentCash = current.cashAmount || 0;
                currentMpesa = current.mpesaAmount || 0;
            }
            if (productName) salesByProduct[productName] = (salesByProduct[productName] || 0) + kg;
            
            const newTotalKg = currentTotalKg + kg;
            const newCash = currentCash + cash;
            const newMpesa = currentMpesa + mpesa;
            
            db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, ?, ?, ?, 0, ?)`,
                [saleDate, newTotalKg, newCash, newMpesa, JSON.stringify(salesByProduct)], (err) => {
                    if (err) {
                        console.log(`[SALE] Database error:`, err);
                        return res.status(400).json({ error: 'Update failed' });
                    }
                    if (productId && productName) {
                        db.run(`UPDATE inventory SET stockKg = stockKg - ? WHERE id = ?`, [kg, productId]);
                    }
                    addActivityLog(req.user.fullName, req.user.role, 'Sales Update', `Sold ${kg}kg of ${productName} on ${saleDate}`);
                    console.log(`[SALE] Success!`);
                    res.json({ message: 'Sales updated' });
                });
        });
    });
});

// CLOSE DAY - NO ROLE RESTRICTION
app.post('/api/close-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    console.log(`[CLOSE DAY] ${req.user.role} (${req.user.username}) closing day: ${date}`);
    
    db.get("SELECT * FROM current_day_sales WHERE date = ? AND isClosed = 0", [date], (err, sales) => {
        if (err || !sales) {
            console.log(`[CLOSE DAY] No active day found`);
            return res.status(400).json({ error: 'No active day to close' });
        }
        const total = (sales.cashAmount || 0) + (sales.mpesaAmount || 0);
        db.run(`INSERT INTO daily_closings (date, totalKg, cashAmount, mpesaAmount, totalRevenue, closedBy) VALUES (?, ?, ?, ?, ?, ?)`,
            [date, sales.totalKg || 0, sales.cashAmount || 0, sales.mpesaAmount || 0, total, req.user.fullName], (err) => {
                if (err) {
                    console.log(`[CLOSE DAY] Failed to insert:`, err);
                    return res.status(400).json({ error: 'Failed to close day' });
                }
                db.run("UPDATE current_day_sales SET isClosed = 1 WHERE date = ?", [date]);
                addActivityLog(req.user.fullName, req.user.role, 'Day Closing', `Closed day ${date} with KES ${total}`);
                console.log(`[CLOSE DAY] Success!`);
                res.json({ message: 'Day closed' });
            });
    });
});

// START NEW DAY - NO ROLE RESTRICTION
app.post('/api/new-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    console.log(`[NEW DAY] ${req.user.role} (${req.user.username}) starting new day: ${date}`);
    
    db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [date]);
    addActivityLog(req.user.fullName, req.user.role, 'New Day', `Started new day for ${date}`);
    res.json({ message: 'New day started', date: date });
});

// DELETE SALE
app.post('/api/delete-sale', authenticateToken, (req, res) => {
    const { productName, kg, date } = req.body;
    const saleDate = date || new Date().toISOString().split('T')[0];
    
    db.get("SELECT salesByProduct, totalKg FROM current_day_sales WHERE date = ? AND isClosed = 0", [saleDate], (err, current) => {
        if (err || !current) return res.status(400).json({ error: 'No active day' });
        let salesByProduct = {};
        try { salesByProduct = JSON.parse(current.salesByProduct || '{}'); } catch(e) {}
        if (!salesByProduct[productName]) return res.status(400).json({ error: 'Sale entry not found' });
        
        const newKg = salesByProduct[productName] - kg;
        if (newKg <= 0.01) delete salesByProduct[productName];
        else salesByProduct[productName] = newKg;
        
        db.run(`UPDATE current_day_sales SET totalKg = totalKg - ?, salesByProduct = ? WHERE date = ? AND isClosed = 0`,
            [kg, JSON.stringify(salesByProduct), saleDate], (err) => {
                if (err) return res.status(400).json({ error: 'Failed to update' });
                db.run(`UPDATE inventory SET stockKg = stockKg + ? WHERE name = ?`, [kg, productName]);
                addActivityLog(req.user.fullName, req.user.role, 'Delete Sale', `Deleted ${kg}kg of ${productName}`);
                res.json({ message: 'Sale entry deleted' });
            });
    });
});

// ========== CLOSINGS ==========
app.get('/api/closings', authenticateToken, (req, res) => {
    db.all("SELECT * FROM daily_closings ORDER BY date DESC", (err, closings) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(closings || []);
    });
});

app.delete('/api/closings/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM daily_closings WHERE id = ?", [req.params.id]);
    res.json({ message: 'Deleted' });
});

// ========== EXPENSES ==========
app.get('/api/expenses', authenticateToken, (req, res) => {
    db.all("SELECT * FROM expenses ORDER BY date DESC", (err, expenses) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(expenses || []);
    });
});

app.post('/api/expenses', authenticateToken, (req, res) => {
    const { category, amount, description, date } = req.body;
    const expenseDate = date || new Date().toISOString().split('T')[0];
    db.run(`INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)`,
        [expenseDate, category, amount, description || ''], function(err) {
            if (err) return res.status(400).json({ error: 'Failed to add expense' });
            res.json({ id: this.lastID, message: 'Expense added' });
        });
});

app.delete('/api/expenses/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
    res.json({ message: 'Deleted' });
});

// ========== USERS (SUPER ADMIN ONLY) ==========
app.get('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.all("SELECT id, username, role, fullName, email, phone, isActive, createdAt, lastLogin FROM users", (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users || []);
    });
});

app.post('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    const { username, password, role, fullName, email, phone } = req.body;
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (username, password, role, fullName, email, phone, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, hashedPassword, role || 'admin', fullName, email || '', phone || '', 1, getLocalTimestamp()],
        function(err) {
            if (err) return res.status(400).json({ error: 'Username already exists' });
            res.json({ id: this.lastID, message: 'User created' });
        });
});

app.put('/api/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    const { fullName, email, phone, password, isActive } = req.body;
    let query = "UPDATE users SET fullName = ?, email = ?, phone = ?";
    let params = [fullName, email || '', phone || ''];
    if (password) {
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, 10);
        query += ", password = ?";
        params.push(hashedPassword);
    }
    if (isActive !== undefined) {
        query += ", isActive = ?";
        params.push(isActive ? 1 : 0);
    }
    query += " WHERE id = ?";
    params.push(req.params.id);
    db.run(query, params);
    res.json({ message: 'User updated' });
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM users WHERE id = ? AND username NOT IN ('superadmin', 'admin1')", [req.params.id]);
    res.json({ message: 'User deleted' });
});

// ========== LOGS (SUPER ADMIN ONLY) ==========
app.get('/api/logs', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.all("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 200", (err, logs) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(logs || []);
    });
});

// ========== DASHBOARD STATS ==========
app.get('/api/dashboard-stats', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    db.get("SELECT totalKg, cashAmount, mpesaAmount FROM current_day_sales WHERE date = ?", [today], (err, todaySales) => {
        db.get("SELECT SUM(stockKg * costKg) as inventoryValue FROM inventory", (err, invValue) => {
            db.get("SELECT COUNT(*) as lowStock FROM inventory WHERE stockKg <= lowStockAlert", (err, lowStock) => {
                db.get("SELECT SUM(totalRevenue) as weeklyRevenue FROM daily_closings WHERE date >= ?", [sevenDaysAgo.toISOString().split('T')[0]], (err, weeklyRev) => {
                    res.json({
                        todaySales: todaySales || { totalKg: 0, cashAmount: 0, mpesaAmount: 0 },
                        inventoryValue: invValue?.inventoryValue || 0,
                        lowStockCount: lowStock?.lowStock || 0,
                        weeklyRevenue: weeklyRev?.weeklyRevenue || 0
                    });
                });
            });
        });
    });
});

// ========== RESET ALL DATA (SUPER ADMIN ONLY) ==========
app.post('/api/reset-all', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    const today = new Date().toISOString().split('T')[0];
    db.serialize(() => {
        db.run("DELETE FROM daily_closings");
        db.run("DELETE FROM expenses");
        db.run("DELETE FROM activity_logs");
        db.run("DELETE FROM current_day_sales");
        db.run(`INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [today]);
        db.run("UPDATE inventory SET stockKg = 0");
        res.json({ message: 'All data has been reset to zero.' });
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 Bismillah Butchery Pro Server Running!');
    console.log('========================================');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`📝 Login: superadmin / admin123 | admin1 / admin123`);
    console.log('========================================\n');
});
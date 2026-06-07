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

// Helper function to round to 2 decimal places
function roundToTwo(num) {
    if (isNaN(num)) return 0;
    return Math.round(num * 100) / 100;
}

// Helper function to get correct local time
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

// Helper function to add activity log
function addActivityLog(userName, userRole, action, details) {
    const importantActions = [
        'Login', 'Logout', 'Sales Update', 'Day Closing', 'New Day',
        'Edit Inventory', 'Add Product', 'Delete Product', 'Expense Added',
        'Delete Expense', 'Create User', 'Delete User', 'Update User',
        'System Reset', 'Delete Record', 'Delete Sale'
    ];
    
    if (!importantActions.includes(action)) return;
    
    const timestamp = getLocalTimestamp();
    db.run(`INSERT INTO activity_logs (timestamp, user, userRole, action, details) VALUES (?, ?, ?, ?, ?)`,
        [timestamp, userName, userRole, action, details]);
    db.run(`DELETE FROM activity_logs WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY id DESC LIMIT 500)`);
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

// Authentication middleware
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
    console.log(`Login attempt: ${username}`);
    
    db.get("SELECT * FROM users WHERE username = ? AND isActive = 1", [username], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
        
        db.run("UPDATE users SET lastLogin = ? WHERE id = ?", [getLocalTimestamp(), user.id]);
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, fullName: user.fullName }, SECRET_KEY, { expiresIn: '24h' });
        
        addActivityLog(user.fullName, user.role, 'Login', `${user.fullName} logged in`);
        console.log(`✅ Login successful: ${username} (${user.role})`);
        
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
        const roundedInventory = inventory.map(i => ({
            ...i,
            stockKg: roundToTwo(i.stockKg),
            priceKg: roundToTwo(i.priceKg),
            costKg: roundToTwo(i.costKg)
        }));
        res.json(roundedInventory || []);
    });
});

app.post('/api/inventory', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    db.run(`INSERT INTO inventory (name, animal, stockKg, priceKg, costKg, lowStockAlert) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, animal, roundToTwo(stockKg), roundToTwo(priceKg), roundToTwo(costKg || priceKg * 0.7), lowStockAlert || 10],
        function(err) {
            if (err) return res.status(400).json({ error: 'Failed to add product' });
            addActivityLog(req.user.fullName, req.user.role, 'Add Product', `Added product: ${name}`);
            res.json({ id: this.lastID, message: 'Product added' });
        });
});

// UPDATE INVENTORY - ALLOWS BOTH SUPER_ADMIN AND ADMIN
app.put('/api/inventory/:id', authenticateToken, (req, res) => {
    // Allow both Super Admin AND Admin to edit inventory
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Permission denied. Only Super Admin and Admin can edit inventory.' });
    }
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    db.run(`UPDATE inventory SET name = ?, animal = ?, stockKg = ?, priceKg = ?, costKg = ?, lowStockAlert = ? WHERE id = ?`,
        [name, animal, roundToTwo(stockKg), roundToTwo(priceKg), roundToTwo(costKg), lowStockAlert, req.params.id],
        (err) => {
            if (err) return res.status(400).json({ error: 'Update failed' });
            addActivityLog(req.user.fullName, req.user.role, 'Edit Inventory', `Edited ${name} - Stock: ${roundToTwo(stockKg)}kg`);
            res.json({ message: 'Product updated' });
        });
});

app.delete('/api/inventory/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.get("SELECT name FROM inventory WHERE id = ?", [req.params.id], (err, product) => {
        const productName = product ? product.name : 'Unknown';
        db.run("DELETE FROM inventory WHERE id = ?", [req.params.id], (err) => {
            addActivityLog(req.user.fullName, req.user.role, 'Delete Product', `Deleted product: ${productName}`);
            res.json({ message: 'Product deleted' });
        });
    });
});

// ========== SALES (NO ROLE RESTRICTIONS - BOTH ADMIN AND SUPER ADMIN CAN USE) ==========
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
                totalKg: roundToTwo(sales.totalKg),
                cashAmount: roundToTwo(sales.cashAmount),
                mpesaAmount: roundToTwo(sales.mpesaAmount),
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
                totalKg: roundToTwo(sales.totalKg),
                cashAmount: roundToTwo(sales.cashAmount),
                mpesaAmount: roundToTwo(sales.mpesaAmount),
                salesByProduct: salesByProduct
            });
        }
    });
});

// ADD SALE - NO ROLE RESTRICTION
app.post('/api/current-sales', authenticateToken, (req, res) => {
    let { kg, cash, mpesa, productId, productName, date } = req.body;
    kg = roundToTwo(kg);
    cash = roundToTwo(cash);
    mpesa = roundToTwo(mpesa);
    const saleDate = date || new Date().toISOString().split('T')[0];
    
    db.get("SELECT isClosed FROM current_day_sales WHERE date = ?", [saleDate], (err, dayStatus) => {
        if (dayStatus && dayStatus.isClosed === 1) return res.status(400).json({ error: 'This day is already closed' });
        
        db.get("SELECT salesByProduct, totalKg, cashAmount, mpesaAmount FROM current_day_sales WHERE date = ?", [saleDate], (err, current) => {
            let salesByProduct = {};
            let currentTotalKg = 0, currentCash = 0, currentMpesa = 0;
            if (current) {
                try { salesByProduct = JSON.parse(current.salesByProduct || '{}'); } catch(e) {}
                currentTotalKg = current.totalKg || 0;
                currentCash = current.cashAmount || 0;
                currentMpesa = current.mpesaAmount || 0;
            }
            if (productName) salesByProduct[productName] = roundToTwo((salesByProduct[productName] || 0) + kg);
            
            db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, ?, ?, ?, 0, ?)`,
                [saleDate, roundToTwo(currentTotalKg + kg), roundToTwo(currentCash + cash), roundToTwo(currentMpesa + mpesa), JSON.stringify(salesByProduct)], (err) => {
                    if (err) return res.status(400).json({ error: 'Update failed' });
                    if (productId && productName) {
                        db.run(`UPDATE inventory SET stockKg = round(stockKg - ?, 2) WHERE id = ?`, [kg, productId]);
                    }
                    addActivityLog(req.user.fullName, req.user.role, 'Sales Update', `Sold ${kg}kg of ${productName} on ${saleDate}, Cash: ${cash}, M-Pesa: ${mpesa}`);
                    res.json({ message: 'Sales updated' });
                });
        });
    });
});

// CLOSE DAY - NO ROLE RESTRICTION
app.post('/api/close-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ? AND isClosed = 0", [date], (err, sales) => {
        if (err || !sales) return res.status(400).json({ error: 'No active day to close' });
        const total = roundToTwo((sales.cashAmount || 0) + (sales.mpesaAmount || 0));
        db.run(`INSERT INTO daily_closings (date, totalKg, cashAmount, mpesaAmount, totalRevenue, closedBy) VALUES (?, ?, ?, ?, ?, ?)`,
            [date, roundToTwo(sales.totalKg || 0), roundToTwo(sales.cashAmount || 0), roundToTwo(sales.mpesaAmount || 0), total, req.user.fullName], (err) => {
                if (err) return res.status(400).json({ error: 'Failed to close day' });
                db.run("UPDATE current_day_sales SET isClosed = 1 WHERE date = ?", [date]);
                addActivityLog(req.user.fullName, req.user.role, 'Day Closing', `Closed day ${date} with KES ${total}`);
                res.json({ message: 'Day closed' });
            });
    });
});

// START NEW DAY - NO ROLE RESTRICTION
app.post('/api/new-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [date]);
    addActivityLog(req.user.fullName, req.user.role, 'New Day', `Started new day for ${date}`);
    res.json({ message: 'New day started', date: date });
});

// DELETE SALE - NO ROLE RESTRICTION
app.post('/api/delete-sale', authenticateToken, (req, res) => {
    const { productName, kg, date } = req.body;
    const saleDate = date || new Date().toISOString().split('T')[0];
    const roundedKg = roundToTwo(kg);
    
    db.get("SELECT salesByProduct, totalKg FROM current_day_sales WHERE date = ? AND isClosed = 0", [saleDate], (err, current) => {
        if (err || !current) return res.status(400).json({ error: 'No active day' });
        let salesByProduct = {};
        try { salesByProduct = JSON.parse(current.salesByProduct || '{}'); } catch(e) {}
        if (!salesByProduct[productName]) return res.status(400).json({ error: 'Sale entry not found' });
        
        const newKg = roundToTwo(salesByProduct[productName] - roundedKg);
        if (newKg <= 0.01) delete salesByProduct[productName];
        else salesByProduct[productName] = newKg;
        
        db.run(`UPDATE current_day_sales SET totalKg = round(totalKg - ?, 2), salesByProduct = ? WHERE date = ? AND isClosed = 0`,
            [roundedKg, JSON.stringify(salesByProduct), saleDate], (err) => {
                if (err) return res.status(400).json({ error: 'Failed to update' });
                db.run(`UPDATE inventory SET stockKg = round(stockKg + ?, 2) WHERE name = ?`, [roundedKg, productName]);
                addActivityLog(req.user.fullName, req.user.role, 'Delete Sale', `Deleted ${roundedKg}kg of ${productName}`);
                res.json({ message: 'Sale entry deleted' });
            });
    });
});

// ========== CLOSINGS ==========
app.get('/api/closings', authenticateToken, (req, res) => {
    db.all("SELECT * FROM daily_closings ORDER BY date DESC", (err, closings) => {
        if (err) return res.status(500).json({ error: err.message });
        const roundedClosings = closings.map(c => ({
            ...c,
            totalKg: roundToTwo(c.totalKg),
            cashAmount: roundToTwo(c.cashAmount),
            mpesaAmount: roundToTwo(c.mpesaAmount),
            totalRevenue: roundToTwo(c.totalRevenue)
        }));
        res.json(roundedClosings || []);
    });
});

app.delete('/api/closings/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM daily_closings WHERE id = ?", [req.params.id]);
    addActivityLog(req.user.fullName, req.user.role, 'Delete Record', 'Deleted closing record');
    res.json({ message: 'Deleted' });
});

// ========== EXPENSES ==========
app.get('/api/expenses', authenticateToken, (req, res) => {
    db.all("SELECT * FROM expenses ORDER BY date DESC", (err, expenses) => {
        if (err) return res.status(500).json({ error: err.message });
        const roundedExpenses = expenses.map(e => ({ ...e, amount: roundToTwo(e.amount) }));
        res.json(roundedExpenses || []);
    });
});

app.post('/api/expenses', authenticateToken, (req, res) => {
    const { category, amount, description, date } = req.body;
    const expenseDate = date || new Date().toISOString().split('T')[0];
    db.run(`INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)`,
        [expenseDate, category, roundToTwo(amount), description || ''], function(err) {
            if (err) return res.status(400).json({ error: 'Failed to add expense' });
            addActivityLog(req.user.fullName, req.user.role, 'Expense Added', `${category}: KES ${roundToTwo(amount)} on ${expenseDate}`);
            res.json({ id: this.lastID, message: 'Expense added' });
        });
});

app.delete('/api/expenses/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
    addActivityLog(req.user.fullName, req.user.role, 'Delete Expense', 'Deleted expense record');
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
            addActivityLog(req.user.fullName, req.user.role, 'Create User', `Created user: ${username} (${fullName})`);
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
    addActivityLog(req.user.fullName, req.user.role, 'Update User', `Updated user ID: ${req.params.id}`);
    res.json({ message: 'User updated' });
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Permission denied' });
    db.get("SELECT username FROM users WHERE id = ?", [req.params.id], (err, user) => {
        const deletedUser = user ? user.username : 'Unknown';
        db.run("DELETE FROM users WHERE id = ? AND username NOT IN ('superadmin', 'admin1')", [req.params.id]);
        addActivityLog(req.user.fullName, req.user.role, 'Delete User', `Deleted user: ${deletedUser}`);
        res.json({ message: 'User deleted' });
    });
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
                        todaySales: todaySales ? {
                            totalKg: roundToTwo(todaySales.totalKg),
                            cashAmount: roundToTwo(todaySales.cashAmount),
                            mpesaAmount: roundToTwo(todaySales.mpesaAmount)
                        } : { totalKg: 0, cashAmount: 0, mpesaAmount: 0 },
                        inventoryValue: roundToTwo(invValue?.inventoryValue || 0),
                        lowStockCount: lowStock?.lowStock || 0,
                        weeklyRevenue: roundToTwo(weeklyRev?.weeklyRevenue || 0)
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
        addActivityLog(req.user.fullName, req.user.role, 'System Reset', 'All data was reset - Stock set to 0');
        res.json({ message: 'All data has been reset to zero. Stock quantities are now 0.' });
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 Bismillah Butchery Pro Server Running!');
    console.log('========================================');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`📝 Login: superadmin / admin123 | admin1 / admin123`);
    console.log('========================================\n');
});
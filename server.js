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
    
    if (!importantActions.includes(action)) {
        return;
    }
    
    const timestamp = getLocalTimestamp();
    
    db.run(`INSERT INTO activity_logs (timestamp, user, userRole, action, details) VALUES (?, ?, ?, ?, ?)`,
        [timestamp, userName, userRole, action, details],
        (err) => {
            if (err) console.error('Error adding activity log:', err);
        });
    
    db.run(`DELETE FROM activity_logs WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY id DESC LIMIT 500)`);
}

// Initialize database tables
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
    
    // Insert default users
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
    
    // Insert default inventory
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
    
    // Initialize current day sales for today
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
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token.' });
        }
        req.user = user;
        next();
    });
}

// Login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt: ${username}`);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.get("SELECT * FROM users WHERE username = ? AND isActive = 1", [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        
        if (!user) {
            console.log(`User not found: ${username}`);
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            console.log(`Invalid password for: ${username}`);
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        db.run("UPDATE users SET lastLogin = ? WHERE id = ?", [getLocalTimestamp(), user.id]);
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, fullName: user.fullName }, 
            SECRET_KEY, 
            { expiresIn: '24h' }
        );
        
        console.log(`✅ Login successful: ${username} (${user.role})`);
        
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

// Get current user
app.get('/api/me', authenticateToken, (req, res) => {
    db.get("SELECT id, username, role, fullName, email, phone FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
});

// Get inventory
app.get('/api/inventory', authenticateToken, (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY id", (err, inventory) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(inventory || []);
    });
});

// Add inventory (super admin only)
app.post('/api/inventory', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    const roundedStockKg = roundToTwo(stockKg);
    const roundedPriceKg = roundToTwo(priceKg);
    const roundedCostKg = roundToTwo(costKg || priceKg * 0.7);
    
    db.run(`INSERT INTO inventory (name, animal, stockKg, priceKg, costKg, lowStockAlert) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, animal, roundedStockKg, roundedPriceKg, roundedCostKg, lowStockAlert || 10],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Failed to add product' });
            }
            db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
                const userName = user ? user.fullName : req.user.username;
                addActivityLog(userName, req.user.role, 'Add Product', `Added product: ${name}`);
            });
            res.json({ id: this.lastID, message: 'Product added' });
        });
});

// Update inventory
app.put('/api/inventory/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    const { name, animal, stockKg, priceKg, costKg, lowStockAlert } = req.body;
    const roundedStockKg = roundToTwo(stockKg);
    const roundedPriceKg = roundToTwo(priceKg);
    const roundedCostKg = roundToTwo(costKg);
    
    db.run(`UPDATE inventory SET name = ?, animal = ?, stockKg = ?, priceKg = ?, costKg = ?, lowStockAlert = ? WHERE id = ?`,
        [name, animal, roundedStockKg, roundedPriceKg, roundedCostKg, lowStockAlert, req.params.id],
        (err) => {
            if (err) {
                return res.status(400).json({ error: 'Update failed' });
            }
            db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
                const userName = user ? user.fullName : req.user.username;
                addActivityLog(userName, req.user.role, 'Edit Inventory', `Edited ${name} - Stock: ${roundedStockKg}kg, Price: ${roundedPriceKg}`);
            });
            res.json({ message: 'Product updated' });
        });
});

// Delete inventory (super admin only)
app.delete('/api/inventory/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.get("SELECT name FROM inventory WHERE id = ?", [req.params.id], (err, product) => {
        const productName = product ? product.name : 'Unknown';
        db.run("DELETE FROM inventory WHERE id = ?", [req.params.id], (err) => {
            if (err) {
                return res.status(400).json({ error: 'Delete failed' });
            }
            db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
                const userName = user ? user.fullName : req.user.username;
                addActivityLog(userName, req.user.role, 'Delete Product', `Deleted product: ${productName}`);
            });
            res.json({ message: 'Product deleted' });
        });
    });
});

// Get sales by specific date
app.get('/api/sales-by-date', authenticateToken, (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ?", [date], (err, sales) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!sales) {
            db.run("INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')", [date]);
            res.json({ date: date, totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} });
        } else {
            let salesByProduct = {};
            try {
                salesByProduct = JSON.parse(sales.salesByProduct || '{}');
            } catch(e) {
                salesByProduct = {};
            }
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

// Get current sales (default - today)
app.get('/api/current-sales', authenticateToken, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM current_day_sales WHERE date = ?", [today], (err, sales) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!sales) {
            db.run("INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')", [today]);
            res.json({ date: today, totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} });
        } else {
            let salesByProduct = {};
            try {
                salesByProduct = JSON.parse(sales.salesByProduct || '{}');
            } catch(e) {
                salesByProduct = {};
            }
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

// Update current sales with date support - FIXED VERSION
app.post('/api/current-sales', authenticateToken, (req, res) => {
    let { kg, cash, mpesa, productId, productName, date } = req.body;
    
    // Round all values
    kg = roundToTwo(kg);
    cash = roundToTwo(cash);
    mpesa = roundToTwo(mpesa);
    const saleDate = date || new Date().toISOString().split('T')[0];
    
    db.get("SELECT salesByProduct, totalKg, cashAmount, mpesaAmount FROM current_day_sales WHERE date = ?", [saleDate], (err, current) => {
        let salesByProduct = {};
        let currentTotalKg = 0;
        let currentCash = 0;
        let currentMpesa = 0;
        
        if (current) {
            try {
                salesByProduct = JSON.parse(current.salesByProduct || '{}');
            } catch(e) {}
            currentTotalKg = current.totalKg || 0;
            currentCash = current.cashAmount || 0;
            currentMpesa = current.mpesaAmount || 0;
        }
        
        if (productName) {
            const existingKg = salesByProduct[productName] || 0;
            salesByProduct[productName] = roundToTwo(existingKg + kg);
        }
        
        const salesByProductStr = JSON.stringify(salesByProduct);
        const newTotalKg = roundToTwo(currentTotalKg + kg);
        const newCash = roundToTwo(currentCash + cash);
        const newMpesa = roundToTwo(currentMpesa + mpesa);
        
        db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
            const userName = user ? user.fullName : req.user.username;
            
            db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, ?, ?, ?, 0, ?)`,
                [saleDate, newTotalKg, newCash, newMpesa, salesByProductStr], (err) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(400).json({ error: 'Update failed' });
                    }
                    
                    if (productId && productName) {
                        db.run(`UPDATE inventory SET stockKg = round(stockKg - ?, 2) WHERE id = ?`, [kg, productId]);
                    }
                    
                    addActivityLog(userName, req.user.role, 'Sales Update', `Sold ${kg}kg of ${productName || 'product'} on ${saleDate}, Cash: ${cash}, M-Pesa: ${mpesa}`);
                    res.json({ message: 'Sales updated' });
                });
        });
    });
});

// Close day with date support - FIXED VERSION
app.post('/api/close-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    
    db.get("SELECT * FROM current_day_sales WHERE date = ? AND isClosed = 0", [date], (err, sales) => {
        if (err || !sales) {
            return res.status(400).json({ error: 'No active day or already closed' });
        }
        
        db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
            const userName = user ? user.fullName : req.user.username;
            const total = roundToTwo((sales.cashAmount || 0) + (sales.mpesaAmount || 0));
            
            db.run(`INSERT INTO daily_closings (date, totalKg, cashAmount, mpesaAmount, totalRevenue, closedBy) VALUES (?, ?, ?, ?, ?, ?)`,
                [date, roundToTwo(sales.totalKg || 0), roundToTwo(sales.cashAmount || 0), roundToTwo(sales.mpesaAmount || 0), total, userName], (err) => {
                    if (err) {
                        console.error('Error closing day:', err);
                        return res.status(400).json({ error: 'Failed to close day' });
                    }
                    db.run("UPDATE current_day_sales SET isClosed = 1 WHERE date = ?", [date]);
                    addActivityLog(userName, req.user.role, 'Day Closing', `Closed day ${date} with KES ${total}`);
                    res.json({ message: 'Day closed' });
                });
        });
    });
});

// Start new day with date support
app.post('/api/new-day', authenticateToken, (req, res) => {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    db.run(`INSERT OR REPLACE INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [date]);
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        addActivityLog(userName, req.user.role, 'New Day', `Started new day for ${date}`);
    });
    res.json({ message: 'New day started' });
});

// Delete sale entry with date support
app.post('/api/delete-sale', authenticateToken, (req, res) => {
    const { productName, kg, date } = req.body;
    const saleDate = date || new Date().toISOString().split('T')[0];
    const roundedKg = roundToTwo(kg);
    
    if (!productName || !roundedKg) {
        return res.status(400).json({ error: 'Product name and quantity required' });
    }
    
    db.get("SELECT salesByProduct, totalKg, cashAmount, mpesaAmount FROM current_day_sales WHERE date = ? AND isClosed = 0", [saleDate], (err, current) => {
        if (err || !current) {
            return res.status(400).json({ error: 'No active day or sale not found' });
        }
        
        let salesByProduct = {};
        if (current.salesByProduct) {
            try {
                salesByProduct = JSON.parse(current.salesByProduct);
            } catch(e) {}
        }
        
        if (!salesByProduct[productName]) {
            return res.status(400).json({ error: 'Sale entry not found' });
        }
        
        const currentKg = salesByProduct[productName];
        const newKg = roundToTwo(currentKg - roundedKg);
        
        if (newKg <= 0.01) {
            delete salesByProduct[productName];
        } else {
            salesByProduct[productName] = newKg;
        }
        
        const salesByProductStr = JSON.stringify(salesByProduct);
        const newTotalKg = roundToTwo((current.totalKg || 0) - roundedKg);
        
        db.run(`UPDATE current_day_sales SET 
            totalKg = ?, 
            salesByProduct = ? 
            WHERE date = ? AND isClosed = 0`,
            [newTotalKg, salesByProductStr, saleDate], (err) => {
                if (err) {
                    return res.status(400).json({ error: 'Failed to update sales' });
                }
                
                db.run(`UPDATE inventory SET stockKg = round(stockKg + ?, 2) WHERE name = ?`, [roundedKg, productName]);
                
                db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
                    const userName = user ? user.fullName : req.user.username;
                    addActivityLog(userName, req.user.role, 'Delete Sale', `Deleted ${roundedKg}kg of ${productName} from ${saleDate} and restored stock`);
                });
                
                res.json({ message: 'Sale entry deleted and stock restored' });
            });
    });
});

// Get closings
app.get('/api/closings', authenticateToken, (req, res) => {
    db.all("SELECT * FROM daily_closings ORDER BY date DESC", (err, closings) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
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

// Delete closing (super admin only)
app.delete('/api/closings/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.run("DELETE FROM daily_closings WHERE id = ?", [req.params.id]);
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        addActivityLog(userName, req.user.role, 'Delete Record', 'Deleted closing record');
    });
    res.json({ message: 'Deleted' });
});

// Get expenses
app.get('/api/expenses', authenticateToken, (req, res) => {
    db.all("SELECT * FROM expenses ORDER BY date DESC", (err, expenses) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const roundedExpenses = expenses.map(e => ({
            ...e,
            amount: roundToTwo(e.amount)
        }));
        res.json(roundedExpenses || []);
    });
});

// Add expense with custom date
app.post('/api/expenses', authenticateToken, (req, res) => {
    const { category, amount, description, date } = req.body;
    const expenseDate = date || new Date().toISOString().split('T')[0];
    const roundedAmount = roundToTwo(amount);
    
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        
        db.run(`INSERT INTO expenses (date, category, amount, description) VALUES (?, ?, ?, ?)`,
            [expenseDate, category, roundedAmount, description || ''], function(err) {
                if (err) {
                    return res.status(400).json({ error: 'Failed to add expense' });
                }
                addActivityLog(userName, req.user.role, 'Expense Added', `${category}: KES ${roundedAmount} on ${expenseDate}`);
                res.json({ id: this.lastID, message: 'Expense added' });
            });
    });
});

// Delete expense (super admin only)
app.delete('/api/expenses/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.run("DELETE FROM expenses WHERE id = ?", [req.params.id]);
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        addActivityLog(userName, req.user.role, 'Delete Expense', 'Deleted expense record');
    });
    res.json({ message: 'Deleted' });
});

// Get users (super admin only)
app.get('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.all("SELECT id, username, role, fullName, email, phone, isActive, createdAt, lastLogin FROM users", (err, users) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(users || []);
    });
});

// Create user (super admin only)
app.post('/api/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    const { username, password, role, fullName, email, phone } = req.body;
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.run(`INSERT INTO users (username, password, role, fullName, email, phone, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, hashedPassword, role || 'admin', fullName, email || '', phone || '', 1, getLocalTimestamp()],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
                const userName = user ? user.fullName : req.user.username;
                addActivityLog(userName, req.user.role, 'Create User', `Created user: ${username} (${fullName})`);
            });
            res.json({ id: this.lastID, message: 'User created' });
        });
});

// Update user
app.put('/api/users/:id', authenticateToken, (req, res) => {
    const { fullName, email, phone, password, isActive } = req.body;
    
    db.get("SELECT username FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (user && user.username === 'superadmin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Cannot modify super admin' });
        }
        
        let query = "UPDATE users SET fullName = ?, email = ?, phone = ?";
        let params = [fullName, email || '', phone || ''];
        
        if (password) {
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(password, 10);
            query += ", password = ?";
            params.push(hashedPassword);
        }
        if (isActive !== undefined && req.user.role === 'super_admin') {
            query += ", isActive = ?";
            params.push(isActive ? 1 : 0);
        }
        query += " WHERE id = ?";
        params.push(req.params.id);
        
        db.run(query, params);
        db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, adminUser) => {
            const adminName = adminUser ? adminUser.fullName : req.user.username;
            addActivityLog(adminName, req.user.role, 'Update User', `Updated user: ${user?.username || 'Unknown'}`);
        });
        res.json({ message: 'User updated' });
    });
});

// Delete user (super admin only)
app.delete('/api/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.get("SELECT username FROM users WHERE id = ?", [req.params.id], (err, user) => {
        const deletedUser = user ? user.username : 'Unknown';
        db.run("DELETE FROM users WHERE id = ? AND username NOT IN ('superadmin', 'admin1')", [req.params.id]);
        db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, adminUser) => {
            const adminName = adminUser ? adminUser.fullName : req.user.username;
            addActivityLog(adminName, req.user.role, 'Delete User', `Deleted user: ${deletedUser}`);
        });
    });
    res.json({ message: 'User deleted' });
});

// Get logs (super admin only)
app.get('/api/logs', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    db.all("SELECT * FROM activity_logs ORDER BY id DESC LIMIT 200", (err, logs) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(logs || []);
    });
});

// Dashboard stats
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

// Reset all data
app.post('/api/reset-all', authenticateToken, (req, res) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Permission denied' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    db.get("SELECT fullName FROM users WHERE id = ?", [req.user.id], (err, user) => {
        const userName = user ? user.fullName : req.user.username;
        
        db.serialize(() => {
            db.run("DELETE FROM daily_closings");
            db.run("DELETE FROM expenses");
            db.run("DELETE FROM activity_logs");
            db.run("DELETE FROM current_day_sales");
            db.run(`INSERT INTO current_day_sales (date, totalKg, cashAmount, mpesaAmount, isClosed, salesByProduct) VALUES (?, 0, 0, 0, 0, '{}')`, [today]);
            db.run("UPDATE inventory SET stockKg = 0", (err) => {
                if (err) {
                    console.error('Error resetting inventory:', err);
                } else {
                    console.log('✅ Inventory stock set to 0 for all products');
                }
            });
            addActivityLog(userName, req.user.role, 'System Reset', 'All data was reset - Stock set to 0, products preserved');
            console.log('✅ All data reset to zero by:', userName);
            res.json({ message: 'All data has been reset to zero. Stock quantities are now 0. Products preserved.' });
        });
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
    console.log(`📝 Login: superadmin / admin123`);
    console.log(`👤 Admin: admin1 / admin123`);
    console.log('========================================\n');
});
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'butchery_data.json');

// Default data structure with sample inventory
const DEFAULT_DATA = {
    users: [
        { id: 1, username: "superadmin", password: "admin123", role: "super_admin", fullName: "Super Admin", email: "super@butchery.com", phone: "0712345678", isActive: true, createdAt: "", lastLogin: null, permissions: ["all"] },
        { id: 2, username: "admin1", password: "admin123", role: "admin", fullName: "John Admin", email: "john@butchery.com", phone: "0723456789", isActive: true, createdAt: "", lastLogin: null, permissions: ["sales", "inventory_view", "reports_view"] }
    ],
    inventory: [
        { id: 1, name: "Cow Sirloin", animal: "Cow", stockKg: 45.5, priceKg: 850, costKg: 560, lowStockAlert: 10, restockDate: "2026-06-15" },
        { id: 2, name: "Goat Leg", animal: "Goat", stockKg: 22.3, priceKg: 950, costKg: 640, lowStockAlert: 8, restockDate: "2026-06-10" },
        { id: 3, name: "Chicken Whole", animal: "Chicken", stockKg: 35.0, priceKg: 550, costKg: 370, lowStockAlert: 12, restockDate: "2026-06-01" },
        { id: 4, name: "Fresh Liver", animal: "Liver", stockKg: 12.8, priceKg: 450, costKg: 300, lowStockAlert: 5, restockDate: "2026-06-18" },
        { id: 5, name: "Matumbo (Tripe)", animal: "Cow", stockKg: 18.5, priceKg: 380, costKg: 250, lowStockAlert: 6, restockDate: "2026-06-05" }
    ],
    dailyClosings: [],
    currentDaySales: { date: "", totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} },
    expenses: [],
    activityLogs: [],
    nextId: { inventory: 6, expenses: 1, users: 3, closings: 1 }
};

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        return false;
    }
}

function findUser(users, username) {
    return users.find(u => u.username === username);
}

function generateId(data, key) {
    data.nextId = data.nextId || {};
    data.nextId[key] = (data.nextId[key] || 0) + 1;
    return data.nextId[key];
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(JSON.stringify(data));
}

function serveStatic(res, filePath, contentType) {
    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 
            'Content-Type': contentType || 'text/html',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(content);
    } catch (error) {
        res.writeHead(404);
        res.end('File not found');
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS
    if (method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // Serve index.html
    if (pathname === '/' || pathname === '/index.html') {
        serveStatic(res, path.join(__dirname, 'public', 'index.html'));
        return;
    }

    // Serve static files from public directory
    if (pathname.startsWith('/public/')) {
        const filePath = path.join(__dirname, pathname);
        const ext = path.extname(filePath);
        const contentType = {
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        }[ext] || 'application/octet-stream';
        serveStatic(res, filePath, contentType);
        return;
    }

    // API Routes
    if (pathname.startsWith('/api/')) {
        const data = loadData();
        
        // ========== LOGIN ==========
        if (pathname === '/api/login' && method === 'POST') {
            const body = await parseBody(req);
            const user = findUser(data.users, body.username);
            if (user && user.password === body.password && user.isActive !== false) {
                const token = Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64');
                user.lastLogin = new Date().toISOString();
                saveData(data);
                sendJSON(res, { 
                    token, 
                    user: { ...user, password: undefined } 
                });
            } else {
                sendJSON(res, { error: 'Invalid credentials' }, 401);
            }
            return;
        }

        // ========== USERS ==========
        if (pathname === '/api/users') {
            if (method === 'GET') {
                sendJSON(res, data.users.map(u => ({ ...u, password: undefined })));
                return;
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                if (findUser(data.users, body.username)) {
                    sendJSON(res, { error: 'Username already exists' }, 400);
                    return;
                }
                const newUser = {
                    id: generateId(data, 'users'),
                    username: body.username,
                    password: body.password,
                    role: body.role || 'admin',
                    fullName: body.fullName || body.username,
                    email: body.email || '',
                    phone: body.phone || '',
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    lastLogin: null,
                    permissions: body.role === 'super_admin' ? ['all'] : ['sales', 'inventory_view', 'reports_view']
                };
                data.users.push(newUser);
                saveData(data);
                sendJSON(res, { ...newUser, password: undefined });
                return;
            }
        }

        if (pathname.startsWith('/api/users/')) {
            const id = parseInt(pathname.split('/')[3]);
            const userIndex = data.users.findIndex(u => u.id === id);
            
            if (method === 'PUT' && userIndex !== -1) {
                const body = await parseBody(req);
                const user = data.users[userIndex];
                if (body.fullName) user.fullName = body.fullName;
                if (body.email) user.email = body.email;
                if (body.phone) user.phone = body.phone;
                if (body.password && body.password.length >= 4) user.password = body.password;
                if (body.role) user.role = body.role;
                saveData(data);
                sendJSON(res, { ...user, password: undefined });
                return;
            }

            if (method === 'DELETE' && userIndex !== -1) {
                if (data.users[userIndex].username === 'superadmin') {
                    sendJSON(res, { error: 'Cannot delete super admin' }, 403);
                    return;
                }
                data.users.splice(userIndex, 1);
                saveData(data);
                sendJSON(res, { success: true });
                return;
            }
        }

        // ========== INVENTORY ==========
        if (pathname === '/api/inventory') {
            if (method === 'GET') {
                sendJSON(res, data.inventory);
                return;
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                const newItem = {
                    id: generateId(data, 'inventory'),
                    name: body.name,
                    animal: body.animal || 'Cow',
                    stockKg: body.stockKg || 0,
                    priceKg: body.priceKg || 0,
                    costKg: body.costKg || (body.priceKg * 0.7),
                    lowStockAlert: body.lowStockAlert || 10,
                    restockDate: body.restockDate || new Date().toISOString().split('T')[0]
                };
                data.inventory.push(newItem);
                
                // Log the new product
                data.activityLogs.push({
                    timestamp: new Date().toISOString(),
                    user: body.userName || 'System',
                    action: 'NEW_PRODUCT',
                    details: `Added new product: ${newItem.name} with ${newItem.stockKg}kg`
                });
                
                saveData(data);
                sendJSON(res, newItem);
                return;
            }
        }

        // ========== INVENTORY PUT (RESTOCK - ADDS TO EXISTING) ==========
        if (pathname.startsWith('/api/inventory/')) {
            const id = parseInt(pathname.split('/')[3]);
            const itemIndex = data.inventory.findIndex(i => i.id === id);
            
            if (method === 'PUT' && itemIndex !== -1) {
                const body = await parseBody(req);
                const item = data.inventory[itemIndex];
                
                // Track old stock for logging
                const oldStock = item.stockKg;
                const stockToAdd = body.stockKg || 0;
                
                // Update basic info
                if (body.name) item.name = body.name;
                if (body.animal) item.animal = body.animal;
                
                // ✅ ADD to existing stock instead of replacing
                if (stockToAdd > 0) {
                    item.stockKg = Math.round((item.stockKg + stockToAdd) * 100) / 100;
                    
                    // Log the restock
                    data.activityLogs.push({
                        timestamp: new Date().toISOString(),
                        user: body.userName || 'System',
                        action: 'RESTOCK',
                        details: `Added ${stockToAdd}kg to ${item.name}. Old: ${oldStock}kg, New: ${item.stockKg}kg`
                    });
                }
                
                if (body.priceKg !== undefined) item.priceKg = body.priceKg;
                if (body.costKg !== undefined) item.costKg = body.costKg;
                if (body.lowStockAlert !== undefined) item.lowStockAlert = body.lowStockAlert;
                if (body.restockDate !== undefined) item.restockDate = body.restockDate;
                
                saveData(data);
                sendJSON(res, { 
                    success: true, 
                    item: item,
                    message: `Added ${stockToAdd}kg to ${item.name}. New total: ${item.stockKg}kg`
                });
                return;
            }

            if (method === 'DELETE' && itemIndex !== -1) {
                const deletedItem = data.inventory[itemIndex];
                data.inventory.splice(itemIndex, 1);
                
                data.activityLogs.push({
                    timestamp: new Date().toISOString(),
                    user: body?.userName || 'System',
                    action: 'DELETE_PRODUCT',
                    details: `Deleted product: ${deletedItem.name}`
                });
                
                saveData(data);
                sendJSON(res, { success: true });
                return;
            }
        }

        // ========== CURRENT SALES (with Inventory Deduction) ==========
        if (pathname === '/api/current-sales') {
            if (method === 'GET') {
                sendJSON(res, data.currentDaySales);
                return;
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                const saleDate = body.date || new Date().toISOString().split('T')[0];
                
                // Initialize day if different date
                if (data.currentDaySales.date !== saleDate || data.currentDaySales.isClosed) {
                    // Check if there's a closing record for this date
                    const closing = data.dailyClosings.find(c => c.date === saleDate);
                    if (closing) {
                        sendJSON(res, { error: 'This day is already closed' }, 400);
                        return;
                    }
                    data.currentDaySales = {
                        date: saleDate,
                        totalKg: 0,
                        cashAmount: 0,
                        mpesaAmount: 0,
                        isClosed: false,
                        salesByProduct: {}
                    };
                }

                if (data.currentDaySales.isClosed) {
                    sendJSON(res, { error: 'Day is already closed' }, 400);
                    return;
                }

                // Find product
                const product = data.inventory.find(p => p.id == body.productId);
                if (!product) {
                    sendJSON(res, { error: 'Product not found' }, 404);
                    return;
                }

                // Check stock
                if (product.stockKg < body.kg) {
                    sendJSON(res, { 
                        error: `Not enough stock! Only ${product.stockKg.toFixed(2)} kg available for ${product.name}` 
                    }, 400);
                    return;
                }

                // ✅ DEDUCT FROM INVENTORY
                product.stockKg = Math.round((product.stockKg - body.kg) * 100) / 100;
                
                // Update sales
                data.currentDaySales.totalKg = Math.round((data.currentDaySales.totalKg + body.kg) * 100) / 100;
                data.currentDaySales.cashAmount = Math.round((data.currentDaySales.cashAmount + (body.cash || 0)) * 100) / 100;
                data.currentDaySales.mpesaAmount = Math.round((data.currentDaySales.mpesaAmount + (body.mpesa || 0)) * 100) / 100;
                
                // Track sales by product
                data.currentDaySales.salesByProduct = data.currentDaySales.salesByProduct || {};
                const productName = body.productName || product.name;
                data.currentDaySales.salesByProduct[productName] = 
                    Math.round(((data.currentDaySales.salesByProduct[productName] || 0) + body.kg) * 100) / 100;

                // Log activity
                data.activityLogs.push({
                    timestamp: new Date().toISOString(),
                    user: body.userName || 'System',
                    action: 'SALE',
                    details: `${body.kg}kg of ${productName} sold for KES ${((body.cash || 0) + (body.mpesa || 0)).toFixed(2)}`
                });

                saveData(data);
                sendJSON(res, { 
                    success: true, 
                    sales: data.currentDaySales,
                    inventory: product
                });
                return;
            }
        }

        // ========== SALES BY DATE ==========
        if (pathname === '/api/sales-by-date' && method === 'GET') {
            const date = parsedUrl.query.date || new Date().toISOString().split('T')[0];
            if (data.currentDaySales.date === date && !data.currentDaySales.isClosed) {
                sendJSON(res, data.currentDaySales);
            } else {
                const closing = data.dailyClosings.find(c => c.date === date);
                if (closing) {
                    sendJSON(res, { 
                        date, 
                        isClosed: true, 
                        totalKg: closing.totalKg, 
                        cashAmount: closing.cashAmount, 
                        mpesaAmount: closing.mpesaAmount, 
                        salesByProduct: closing.salesByProduct || {} 
                    });
                } else {
                    sendJSON(res, { date, totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} });
                }
            }
            return;
        }

        // ========== NEW DAY ==========
        if (pathname === '/api/new-day' && method === 'POST') {
            const body = await parseBody(req);
            const date = body.date || new Date().toISOString().split('T')[0];
            
            // Check if day is already closed
            const closing = data.dailyClosings.find(c => c.date === date);
            if (closing) {
                sendJSON(res, { error: 'This day is already closed' }, 400);
                return;
            }
            
            data.currentDaySales = {
                date: date,
                totalKg: 0,
                cashAmount: 0,
                mpesaAmount: 0,
                isClosed: false,
                salesByProduct: {}
            };
            
            data.activityLogs.push({
                timestamp: new Date().toISOString(),
                user: body.userName || 'System',
                action: 'NEW_DAY',
                details: `Started new day: ${date}`
            });
            
            saveData(data);
            sendJSON(res, { success: true, sales: data.currentDaySales });
            return;
        }

        // ========== CLOSE DAY ==========
        if (pathname === '/api/close-day' && method === 'POST') {
            const body = await parseBody(req);
            const date = body.date || data.currentDaySales.date;
            
            if (data.currentDaySales.isClosed) {
                sendJSON(res, { error: 'Day already closed' }, 400);
                return;
            }

            const totalRevenue = (data.currentDaySales.cashAmount || 0) + (data.currentDaySales.mpesaAmount || 0);
            
            const closingRecord = {
                id: generateId(data, 'closings'),
                date: date,
                totalKg: data.currentDaySales.totalKg || 0,
                cashAmount: data.currentDaySales.cashAmount || 0,
                mpesaAmount: data.currentDaySales.mpesaAmount || 0,
                totalRevenue: totalRevenue,
                closedBy: body.closedBy || 'System',
                closedAt: new Date().toISOString(),
                salesByProduct: data.currentDaySales.salesByProduct || {}
            };

            data.dailyClosings.push(closingRecord);
            data.currentDaySales.isClosed = true;
            
            data.activityLogs.push({
                timestamp: new Date().toISOString(),
                user: body.closedBy || 'System',
                action: 'CLOSE_DAY',
                details: `Closed day ${date} with ${data.currentDaySales.totalKg}kg sold, Revenue: KES ${totalRevenue.toFixed(2)}`
            });
            
            saveData(data);
            sendJSON(res, { success: true, record: closingRecord });
            return;
        }

        // ========== DELETE SALE ENTRY (Restores Inventory) ==========
        if (pathname === '/api/delete-sale' && method === 'POST') {
            const body = await parseBody(req);
            const productName = body.productName;
            const kgToRemove = body.kg || 0;

            if (data.currentDaySales.isClosed) {
                sendJSON(res, { error: 'Cannot delete from closed day' }, 400);
                return;
            }

            // ✅ RESTORE INVENTORY
            const product = data.inventory.find(p => p.name === productName);
            if (product) {
                product.stockKg = Math.round((product.stockKg + kgToRemove) * 100) / 100;
            }

            // Remove from sales
            if (data.currentDaySales.salesByProduct && data.currentDaySales.salesByProduct[productName]) {
                const currentKg = data.currentDaySales.salesByProduct[productName];
                const newKg = Math.round((currentKg - kgToRemove) * 100) / 100;
                if (newKg <= 0) {
                    delete data.currentDaySales.salesByProduct[productName];
                } else {
                    data.currentDaySales.salesByProduct[productName] = newKg;
                }
                data.currentDaySales.totalKg = Math.round((data.currentDaySales.totalKg - kgToRemove) * 100) / 100;
            }

            saveData(data);
            sendJSON(res, { success: true });
            return;
        }

        // ========== EXPENSES ==========
        if (pathname === '/api/expenses') {
            if (method === 'GET') {
                sendJSON(res, data.expenses);
                return;
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                const newExpense = {
                    id: generateId(data, 'expenses'),
                    date: body.date || new Date().toISOString().split('T')[0],
                    category: body.category,
                    amount: body.amount || 0,
                    description: body.description || ''
                };
                data.expenses.push(newExpense);
                data.activityLogs.push({
                    timestamp: new Date().toISOString(),
                    user: body.userName || 'System',
                    action: 'EXPENSE',
                    details: `Added ${body.category} expense: KES ${body.amount}`
                });
                saveData(data);
                sendJSON(res, newExpense);
                return;
            }
        }

        if (pathname.startsWith('/api/expenses/')) {
            const id = parseInt(pathname.split('/')[3]);
            const expenseIndex = data.expenses.findIndex(e => e.id === id);
            
            if (method === 'DELETE' && expenseIndex !== -1) {
                data.expenses.splice(expenseIndex, 1);
                saveData(data);
                sendJSON(res, { success: true });
                return;
            }
        }

        // ========== CLOSINGS ==========
        if (pathname === '/api/closings' && method === 'GET') {
            sendJSON(res, data.dailyClosings);
            return;
        }

        if (pathname.startsWith('/api/closings/')) {
            const id = parseInt(pathname.split('/')[3]);
            const closingIndex = data.dailyClosings.findIndex(c => c.id === id);
            
            if (method === 'DELETE' && closingIndex !== -1) {
                data.dailyClosings.splice(closingIndex, 1);
                saveData(data);
                sendJSON(res, { success: true });
                return;
            }
        }

        // ========== LOGS ==========
        if (pathname === '/api/logs' && method === 'GET') {
            sendJSON(res, data.activityLogs || []);
            return;
        }

        // ========== RESET ALL ==========
        if (pathname === '/api/reset-all' && method === 'POST') {
            data.inventory = DEFAULT_DATA.inventory.map(item => ({ ...item }));
            data.dailyClosings = [];
            data.currentDaySales = { date: "", totalKg: 0, cashAmount: 0, mpesaAmount: 0, isClosed: false, salesByProduct: {} };
            data.expenses = [];
            data.activityLogs = [];
            data.nextId = { inventory: 6, expenses: 1, users: 3, closings: 1 };
            saveData(data);
            sendJSON(res, { success: true });
            return;
        }

        // ========== ME ==========
        if (pathname === '/api/me' && method === 'GET') {
            const auth = req.headers.authorization;
            if (auth && auth.startsWith('Bearer ')) {
                try {
                    const token = auth.split(' ')[1];
                    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
                    const user = data.users.find(u => u.id === decoded.id);
                    if (user) {
                        sendJSON(res, { ...user, password: undefined });
                        return;
                    }
                } catch (error) {
                    sendJSON(res, { error: 'Invalid token' }, 401);
                    return;
                }
            }
            sendJSON(res, { error: 'Unauthorized' }, 401);
            return;
        }

        // 404 for API
        sendJSON(res, { error: 'API endpoint not found' }, 404);
        return;
    }

    // 404 for non-API
    res.writeHead(404);
    res.end('Not Found');
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('BISMILLAH BUTCHERY PRO SERVER (Node.js)');
    console.log('='.repeat(50));
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log('📖 DAILY WORKFLOW:');
    console.log('1. Login as Admin');
    console.log('2. Record each sale → Inventory auto-deducted');
    console.log('3. At end of day, click "Close Day"');
    console.log('4. Next day, click "Start New Day"');
    console.log('5. Add expenses when they occur');
    console.log('6. Restock → ADDS to existing stock (not replace)');
    console.log('7. Track restock dates in inventory');
    console.log('='.repeat(50));
    console.log('Press Ctrl+C to stop');
    console.log('='.repeat(50));
});

process.on('SIGINT', () => {
    console.log('\nServer stopped.');
    process.exit(0);
});
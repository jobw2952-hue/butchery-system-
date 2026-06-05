import http.server
import socketserver
import json
import os

PORT = 8080
DATA_FILE = 'butchery_data.json'

DEFAULT_DATA = {
    "users": [
        {"id": 1, "username": "superadmin", "password": "admin123", "role": "super_admin", "fullName": "Super Admin", "email": "super@butchery.com", "phone": "0712345678", "isActive": True, "createdAt": "", "lastLogin": None, "permissions": ["all"]},
        {"id": 2, "username": "admin1", "password": "admin123", "role": "admin", "fullName": "John Admin", "email": "john@butchery.com", "phone": "0723456789", "isActive": True, "createdAt": "", "lastLogin": None, "permissions": ["sales", "inventory_view", "reports_view"]}
    ],
    "inventory": [
        {"id": 1, "name": "Cow Sirloin", "animal": "Cow", "stockKg": 45.5, "priceKg": 850, "costKg": 560, "lowStockAlert": 10},
        {"id": 2, "name": "Goat Leg", "animal": "Goat", "stockKg": 22.3, "priceKg": 950, "costKg": 640, "lowStockAlert": 8},
        {"id": 3, "name": "Chicken Whole", "animal": "Chicken", "stockKg": 35.0, "priceKg": 550, "costKg": 370, "lowStockAlert": 12},
        {"id": 4, "name": "Fresh Liver", "animal": "Liver", "stockKg": 12.8, "priceKg": 450, "costKg": 300, "lowStockAlert": 5},
        {"id": 5, "name": "Matumbo (Tripe)", "animal": "Cow", "stockKg": 18.5, "priceKg": 380, "costKg": 250, "lowStockAlert": 6}
    ],
    "dailyClosings": [],
    "currentDaySales": {"date": "", "totalKg": 0, "cashAmount": 0, "mpesaAmount": 0, "isClosed": False},
    "expenses": [],
    "activityLogs": [],
    "nextId": {"inventory": 6, "expenses": 1, "users": 3, "closings": 1}
}

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    return DEFAULT_DATA.copy()

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.path = '/butchery.html'
        elif self.path == '/api/data':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(load_data()).encode())
            return
        return http.server.SimpleHTTPRequestHandler.do_GET(self)
    
    def do_POST(self):
        if self.path == '/api/save':
            length = int(self.headers['Content-Length'])
            data = json.loads(self.rfile.read(length))
            current = load_data()
            for key in ['users', 'inventory', 'dailyClosings', 'currentDaySales', 'expenses', 'activityLogs', 'nextId']:
                if key in data:
                    current[key] = data[key]
            save_data(current)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    import socket
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    print("="*50)
    print("BISMILLAH BUTCHERY PRO SERVER")
    print("="*50)
    print(f"Server running on http://localhost:{PORT}")
    print(f"Other devices: http://{local_ip}:{PORT}")
    print("="*50)
    print("Press Ctrl+C to stop")
    print("="*50)
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
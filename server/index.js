import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database setup
const dbFile = path.join(__dirname, 'database.json');

// Initialize database if not exists
if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({ users: [], bots: [] }, null, 2));
}

// Helper to read DB
const readDB = () => {
    const data = fs.readFileSync(dbFile, 'utf8');
    return JSON.parse(data);
};

// Helper to write DB
const writeDB = (data) => {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};

// ----------- API Endpoints ----------- //

// 1. Authentication (Login / Register)
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const db = readDB();
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
    }

    const newUser = { id: Date.now().toString(), username, password, createdAt: new Date().toISOString() };
    db.users.push(newUser);
    writeDB(db);

    res.status(201).json(newUser);
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const db = readDB();
    const user = db.users.find(u => u.username === username);

    if (!user) {
        return res.status(404).json({ error: 'الحساب غير موجود' });
    }
    if (user.password !== password) {
        return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    res.json(user);
});

// 2. Bots CRUD operations
// Get all bots for a user
app.get('/api/bots/:username', (req, res) => {
    const { username } = req.params;
    const db = readDB();
    const userBots = db.bots.filter(b => b.owner === username);
    res.json(userBots);
});

// Create a new bot
app.post('/api/bots', (req, res) => {
    const newBot = req.body;
    const db = readDB();
    db.bots.push(newBot);
    writeDB(db);
    res.status(201).json(newBot);
});

// Update a bot (like files, status)
app.put('/api/bots/:id', (req, res) => {
    const { id } = req.params;
    const updatedBot = req.body;
    const db = readDB();
    
    const index = db.bots.findIndex(b => b.id === id);
    if (index > -1) {
        db.bots[index] = { ...db.bots[index], ...updatedBot };
        writeDB(db);
        res.json(db.bots[index]);
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});

// Delete a bot
app.delete('/api/bots/:id', (req, res) => {
    const { id } = req.params;
    const db = readDB();
    db.bots = db.bots.filter(b => b.id !== id);
    writeDB(db);
    res.json({ success: true });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Server running at port ${PORT}`);
    console.log(`📂 Database stored at ${dbFile}`);
});

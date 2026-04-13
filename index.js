const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'supersecretkey_for_studygroup';

// Middleware to authenticate
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    });
};

// 1. Auth Endpoints
app.post('/api/auth/register', (req, res) => {
    const { name, email, password, program, year } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 8);
    
    db.run(
        `INSERT INTO users (name, email, password, program, year) VALUES (?, ?, ?, ?, ?)`,
        [name, email, hashedPassword, program, year],
        function(err) {
            if (err) return res.status(400).json({ error: 'Email already exists or invalid data' });
            res.json({ message: 'User registered successfully', userId: this.lastID });
        }
    );
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'User not found' });
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
    });
});

app.get('/api/auth/me', authenticate, (req, res) => {
    db.get(`SELECT id, name, email, program, year, role FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

// 2. Group Endpoints
app.post('/api/groups', authenticate, (req, res) => {
    const { name, course, description, location } = req.body;
    db.run(
        `INSERT INTO study_groups (name, course, description, location, leader_id) VALUES (?, ?, ?, ?, ?)`,
        [name, course, description, location, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const groupId = this.lastID;
            db.run(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`, [groupId, req.user.id], (err) => {
                if (err) console.error(err);
                res.json({ message: 'Group created', groupId });
            });
        }
    );
});

app.get('/api/groups', authenticate, (req, res) => {
    db.all(`SELECT sg.*, (SELECT COUNT(*) FROM group_members WHERE group_id = sg.id) as member_count FROM study_groups sg`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/groups/:id', authenticate, (req, res) => {
    const groupId = req.params.id;
    db.get(`SELECT sg.*, u.name as leader_name FROM study_groups sg JOIN users u ON sg.leader_id = u.id WHERE sg.id = ?`, [groupId], (err, group) => {
        if (err || !group) return res.status(404).json({ error: 'Group not found' });
        
        db.all(`SELECT u.id, u.name, u.role FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`, [groupId], (err, members) => {
            if (err) return res.status(500).json({ error: err.message });
            group.members = members;
            res.json(group);
        });
    });
});

app.post('/api/groups/:id/join', authenticate, (req, res) => {
    const groupId = req.params.id;
    db.run(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`, [groupId, req.user.id], function(err) {
        if (err) return res.status(400).json({ error: 'Already joined or group not found' });
        res.json({ message: 'Joined successfully' });
    });
});

app.get('/api/user/groups', authenticate, (req, res) => {
    db.all(`SELECT sg.* FROM study_groups sg JOIN group_members gm ON sg.id = gm.group_id WHERE gm.user_id = ?`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. Sessions Endpoints
app.post('/api/sessions', authenticate, (req, res) => {
    const { group_id, date, time, location, description } = req.body;
    // Basic verification - checking if leader (omitted for MVP speed, but good practice to add later)
    db.run(
        `INSERT INTO sessions (group_id, date, time, location, description) VALUES (?, ?, ?, ?, ?)`,
        [group_id, date, time, location, description],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Session created', sessionId: this.lastID });
        }
    );
});

app.get('/api/sessions', authenticate, (req, res) => {    
    // Get sessions for groups the user belongs to
    db.all(`SELECT s.*, sg.name as group_name FROM sessions s JOIN study_groups sg ON s.group_id = sg.id JOIN group_members gm ON sg.id = gm.group_id WHERE gm.user_id = ? ORDER BY date, time ASC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/groups/:id/sessions', authenticate, (req, res) => {
    db.all(`SELECT * FROM sessions WHERE group_id = ? ORDER BY date, time ASC`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


// 4. Posts Endpoints
app.post('/api/posts', authenticate, (req, res) => {
    const { group_id, content } = req.body;
    db.run(
        `INSERT INTO posts (group_id, user_id, content) VALUES (?, ?, ?)`,
        [group_id, req.user.id, content],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Post created', postId: this.lastID });
        }
    );
});

app.get('/api/groups/:id/posts', authenticate, (req, res) => {
    db.all(`SELECT p.*, u.name as author_name FROM posts p JOIN users u ON p.user_id = u.id WHERE p.group_id = ? ORDER BY timestamp DESC`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin Dashboard stats
app.get('/api/admin/stats', authenticate, (req, res) => {
    db.get(`SELECT COUNT(*) as totalUsers FROM users`, [], (err, row1) => {
        db.get(`SELECT COUNT(*) as totalGroups FROM study_groups`, [], (err, row2) => {
            res.json({ totalUsers: row1.totalUsers, totalGroups: row2.totalGroups });
        });
    });
});

app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});

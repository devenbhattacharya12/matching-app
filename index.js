require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || "supersecretkey";

app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect('mongodb+srv://devenbhattacharya:deven123@app-comment.583cy.mongodb.net/tutorApp', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'tutor'], required: true },
  grade: { type: Number, required: true }
});

const User = mongoose.model('User', userSchema);

// ================== STUDENT-TUTOR MATCHING LOGIC ==================

// Find a tutor closest to the student's grade
async function matchStudentToTutor(student) {
    console.log("🔍 Finding tutor for student in grade:", student.grade);

    let tutor = await User.findOne({ role: 'tutor', grade: student.grade });

    if (!tutor) {
        console.log("⚠️ No exact match found. Searching for the closest grade.");
        tutor = await User.findOne({ role: 'tutor' }).sort({ grade: 1 }); // Finds the closest match
    }

    if (!tutor) {
        console.log("❌ No tutors found at all.");
    } else {
        console.log("✅ Matched Tutor:", tutor.username, "Grade:", tutor.grade);
    }

    return tutor;
}

// ================== AUTHENTICATION ROUTES ==================

// Register User
app.post('/register', async (req, res) => {
    const { username, password, role, grade } = req.body;

    if (!username || !password || !role || grade === undefined) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, role, grade });
        await newUser.save();

        res.status(201).json({ message: 'User registered successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to register user.' });
    }
});

// Login User
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'User not found. Please register.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        const token = jwt.sign({ userId: user._id, username: user.username, role: user.role, grade: user.grade }, SECRET_KEY, { expiresIn: '2h' });

        res.json({ message: 'Login successful!', token });
    } catch (err) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

// ================== MATCHING ROUTE ==================

// Get Matched Tutor for a Student
app.get('/match-tutor', async (req, res) => {
    const { userId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format.' });
    }

    try {
        const student = await User.findById(new mongoose.Types.ObjectId(userId));
        
        if (!student) {
            console.log("❌ Student not found.");
            return res.status(400).json({ error: 'Student not found.' });
        }

        if (student.role !== 'student') {
            console.log("❌ User is not a student:", student.username);
            return res.status(400).json({ error: 'Invalid student role.' });
        }

        const tutor = await matchStudentToTutor(student);
        if (!tutor) {
            console.log("❌ No tutors available.");
            return res.status(404).json({ error: 'No available tutors at this time.' });
        }

        console.log("✅ Matched Tutor:", tutor.username, "for student:", student.username);
        res.json({ message: 'Tutor matched!', tutor: { username: tutor.username, grade: tutor.grade } });

    } catch (err) {
        console.error("❌ Error matching tutor:", err);
        res.status(500).json({ error: 'Error matching tutor.' });
    }
});

// ================== REAL-TIME CHAT ==================

let activeUsers = {}; // Store active user sessions

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join', (data) => {
        const { username, role } = data;
        activeUsers[username] = { socketId: socket.id, role };
        console.log(`${username} (${role}) joined.`);

        if (role === 'student') {
            const tutor = Object.keys(activeUsers).find(user => activeUsers[user].role === 'tutor');
            if (tutor) {
                io.to(socket.id).emit('matched', { tutor });
            }
        }
    });

    socket.on('chatMessage', (data) => {
        const { sender, receiver, message } = data;
        if (activeUsers[receiver]) {
            io.to(activeUsers[receiver].socketId).emit('chatMessage', { sender, message });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let user in activeUsers) {
            if (activeUsers[user].socketId === socket.id) {
                delete activeUsers[user];
            }
        }
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

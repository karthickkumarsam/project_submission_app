import express from 'express'
import cors from 'cors'
import bcrypt from 'bcrypt'
import admin from 'firebase-admin'
import path from 'path'
import { fileURLToPath } from "url";
import dotenv from 'dotenv'
dotenv.config()

// Firebase Admin from env
const serviceAccount = {
  project_id: process.env.FB_PROJECT_ID,
  client_email: process.env.FB_CLIENT_EMAIL,
  private_key: process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

const app = express()
app.use(cors())
app.use(express.json())

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/public", express.static(path.join(__dirname, "public")))

// Firebase init
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore()
const studentCollection = db.collection('students')
const facultyCollection = db.collection('faculty')

// Health check
app.get('/', (req, res) => {
    res.json({ message: "API is running ✅" })
})

// register
app.post("/register", async (req, res) => {
    try {
        const { name, email, password, role } = req.body
        if(!email || !password || !role) return res.status(400).json({ message: "Missing fields" })

        if(!['student', 'faculty'].includes(role)) {
            return res.status(400).json({ message: "Invalid role" })
        }

        const collection = role == 'student' ? studentCollection : facultyCollection
        const userDoc = await collection.doc(email).get()
        if(userDoc.exists) return res.status(400).json({ message: "Email already exists" })

        const hashedPassword = await bcrypt.hash(password, 10)
        await collection.doc(email).set({
            name,
            email,
            role,
            password: hashedPassword,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        })

        res.status(201).json({ message: "Registered successfully", user: { name, email, role } })
        
    } catch (error) {
        console.error("Error registering user:", error)
        res.status(500).json({ message: "Internal server error" })
    }
})

app.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body
        if(!email || !password || !role) return res.status(400).json({ message: "Missing fields" })

        if(!['student', 'faculty'].includes(role)) {
            return res.status(400).json({ message: "Invalid role" })
        }   

        const collection = role == 'student' ? studentCollection: facultyCollection

        const userDoc = await collection.doc(email).get()
        if(!userDoc.exists) return res.status(400).json({ message: "Invalid credentials" })

        const userData = userDoc.data()
        const isMatch = await bcrypt.compare(password, userData.password)  
        if(!isMatch) return res.status(400).json({ message: "Invalid credentials" })

        res.json({ message: "Login successful", user: { name: userData.name, email: userData.email, role: userData.role } })

    } catch (error) {
        console.error("Error logging in user:", error)
        res.status(500).json({ message: "Internal server error" })
    }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
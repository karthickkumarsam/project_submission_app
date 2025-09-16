import express from 'express'
import cors from 'cors'
import bcrypt from 'bcrypt'
import admin from 'firebase-admin'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
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

const uploadDir = path.join(process.cwd(), 'public')
if(!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir)
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName)
    }
})
const upload = multer({ storage })

// Health check
app.get('/', (req, res) => {
    res.json({ message: "API is running ✅" })
})

// Register
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body
    if (!email || !password || !role) {
      return res.status(400).json({ message: "Missing fields" })
    }

    if (!['student', 'faculty'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" })
    }

    const collection = role === 'student' ? studentCollection : facultyCollection

    // Check if email already exists
    const existingUser = await collection.where("email", "==", email).get()
    if (!existingUser.empty) {
      return res.status(400).json({ message: "Email already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // Generate unique Firestore doc ID
    const newDocRef = collection.doc()
    await newDocRef.set({
      id: newDocRef.id,
      name: name || "",
      email,
      role,
      password: hashedPassword,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })

    res.status(201).json({
      message: "Registered successfully",
      user: { id: newDocRef.id, name, email, role }
    })
  } catch (error) {
    console.error("Error registering user:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body
    if (!email || !password || !role) {
      return res.status(400).json({ message: "Missing fields" })
    }

    if (!['student', 'faculty'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" })
    }

    const collection = role === 'student' ? studentCollection : facultyCollection

    // Query by email
    const snapshot = await collection.where("email", "==", email).limit(1).get()
    if (snapshot.empty) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    const userDoc = snapshot.docs[0]
    const userData = userDoc.data()

    const isMatch = await bcrypt.compare(password, userData.password)
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" })

    res.json({
      message: "Login successful",
      user: { id: userData.id, name: userData.name, email: userData.email, role: userData.role }
    })
  } catch (error) {
    console.error("Error logging in user:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

app.post('/project/submit', upload.single('document'), async (req, res) => {
    try {
        const { title, description, studentId } = req.body

        if (!studentId) return res.status(400).json({ message: "Missing studentId" })
        if(!req.file) return res.status(400).json({ message: "No file uploaded" })

        // Verify student exists
        const studentDoc = await studentCollection.doc(studentId).get()
        if (!studentDoc.exists) {
        return res.status(404).json({ message: "Student not found" })
        }            

        const filePath = `/public/${req.file.filename}`    

        const projectRef = db.collection('projects').doc()
        await projectRef.set({
            id: projectRef.id,
            title,
            description,
            studentId,
            documentUrl: filePath,
            fileType: req.file.mimetype,
            fileName: req.file.originalname,
            status: "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        res.json({ message: "Project submitted successfully", projectId: projectRef.id, studentId, documentUrl: filePath })
        
    } catch (error) {
        console.error("Error submitting project:", error)
        res.status(500).json({ message: "Internal server error" })
    }
})

app.get('/projects', async (req, res) => {
    try {
        const snapshot = await db.collection('projects').get()
        if(snapshot.empty) return res.json({ projects: [] })

        const projects = snapshot.docs.map((doc) => doc.data())
        res.json({ projects })
        
    } catch (error) {
        console.error("Error fetching projects:", error)
        res.status(500).json({ message: "Internal server error" })  
    }
})

app.put('/project/review/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params
        const { status, reason, mark } = req.body

        if(!['approve', 'reject'].includes(status)) {
            return res.status(400).json({ message: "Invalid status" })
        }

        const projectRef = db.collection('projects').doc(projectId)
        await projectRef.update({
            status,
            mark,
            reviewReason: reason || "",
            reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        res.json({ message: `Project ${status} successfully` })
        
    } catch (error) {
        console.error("Error reviewing project:", error)
        res.status(500).json({ message: "Internal server error" })
    }
})

// Get projects by studentId
app.get('/projects/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params

    if (!studentId) return res.status(400).json({ message: "Missing studentId" })

    const snapshot = await db.collection('projects').where("studentId", "==", studentId).get()

    if (snapshot.empty) {
      return res.json({ projects: [] })
    }

    const projects = snapshot.docs.map((doc) => doc.data())

    res.json({ projects })

  } catch (error) {
    console.error("Error fetching projects by studentId:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Get single project by projectId
app.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params

    if (!projectId) return res.status(400).json({ message: "Missing projectId" })

    const projectDoc = await db.collection('projects').doc(projectId).get()

    if (!projectDoc.exists) {
      return res.status(404).json({ message: "Project not found" })
    }

    res.json({ project: projectDoc.data() })

  } catch (error) {
    console.error("Error fetching single project:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})


const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
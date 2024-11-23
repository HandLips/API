// Import dependencies
require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const { Storage } = require("@google-cloud/storage");

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Cloud Storage setup
const storage = new Storage({
  projectId: process.env.PROJECT_ID,
});
const bucket = storage.bucket(process.env.BUCKET_NAME);

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/jpg"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File harus berupa gambar."));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Database connection pool
const pool = mysql.createPool(dbConfig);

// Helper function to handle database queries
async function query(sql, params) {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    connection.release();
  }
}

// Helper function for file upload to Google Cloud Storage
async function uploadFile(file) {
  const blob = bucket.file(`profiles/${Date.now()}-${file.originalname}`);
  const blobStream = blob.createWriteStream({
    resumable: false,
    metadata: {
      contentType: file.mimetype,
    },
  });

  return new Promise((resolve, reject) => {
    blobStream.on("error", (err) => reject(err));
    blobStream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve(publicUrl);
    });
    blobStream.end(file.buffer);
  });
}

// HISTORY API ENDPOINTS

// Create History
app.post("/api/history", async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Judul dan pesan harus diisi",
      });
    }

    const result = await query(
      "INSERT INTO history (title, message) VALUES (?, ?)",
      [title, message]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        title,
        message,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get All History
app.get("/api/history", async (req, res) => {
  try {
    const histories = await query(
      "SELECT * FROM history ORDER BY created_at DESC"
    );

    res.json({
      success: true,
      data: histories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get History Detail
app.get("/api/history/:id", async (req, res) => {
  try {
    const [history] = await query("SELECT * FROM history WHERE id = ?", [
      req.params.id,
    ]);

    if (!history) {
      return res.status(404).json({
        success: false,
        message: "Tidak memiliki akses",
      });
    }

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// PROFILE API ENDPOINTS

// Get Profile
app.get("/api/profile", async (req, res) => {
  try {
    const [profile] = await query("SELECT * FROM profile LIMIT 1");

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profil tidak ditemukan",
      });
    }

    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update Profile
app.put("/api/profile", upload.single("profile_picture"), async (req, res) => {
  try {
    const { name } = req.body;
    let profilePictureUrl = null;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (req.file) {
      profilePictureUrl = await uploadFile(req.file);
    }

    const updateQuery = profilePictureUrl
      ? "UPDATE profile SET name = ?, profile_picture_url = ? WHERE id = 1"
      : "UPDATE profile SET name = ? WHERE id = 1";

    const params = profilePictureUrl ? [name, profilePictureUrl] : [name];

    await query(updateQuery, params);

    res.json({
      success: true,
      data: {
        name,
        profile_picture_url: profilePictureUrl,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// FEEDBACK API ENDPOINTS

// Create Feedback
app.post("/api/feedback", async (req, res) => {
  try {
    const { comment, rating } = req.body;

    if (!comment || !rating) {
      return res.status(400).json({
        success: false,
        message: "Komentar dan rating harus diisi",
      });
    }

    if (rating < 1 || rating > 4) {
      return res.status(400).json({
        success: false,
        message: "Rating harus antara 1-4",
      });
    }

    const result = await query(
      "INSERT INTO feedback (comment, rating) VALUES (?, ?)",
      [comment, rating]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        comment,
        rating,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    message: err.message,
  });
});

// Start
const PORT = process.env.PORT || 2004;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  console.log(`Test API at: http://localhost:${PORT}`);
  console.log("\nAvailable routes:");
  console.log("- GET    /test");
  console.log("- GET    /api/history");
  console.log("- POST   /api/history");
  console.log("- GET    /api/history/:id");
  console.log("- GET    /api/profile");
  console.log("- PUT    /api/profile");
  console.log("- POST   /api/feedback");
});

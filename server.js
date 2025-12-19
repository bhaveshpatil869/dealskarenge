const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const ejs = require('ejs');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const basicAuth = require('express-basic-auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Initialize SQLite database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      originalName TEXT NOT NULL,
      uploadDate DATETIME NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      isCurrent BOOLEAN DEFAULT FALSE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS website_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT
    )
  `);
});

// Set up EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public/videos/views'));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ensure directories exist
fs.ensureDirSync('public/uploads');
fs.ensureDirSync('public/videos');
fs.ensureDirSync('views');

// Video storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

// Admin Authentication Middleware
const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USERNAME || 'admin']: process.env.ADMIN_PASSWORD || 'password' },
  challenge: true,
  realm: 'Admin Area'
});

// Routes
app.get('/video/:id', (req, res) => {
  const videoId = req.params.id;
  db.get('SELECT path, filename FROM videos WHERE id = ?', [videoId], (err, row) => {
    if (err) {
      console.error('Error fetching video:', err);
      return res.status(500).send('Error loading video');
    }
    if (!row) {
      return res.status(404).send('Video not found');
    }
    // Normalize the path to handle Windows backslashes
    const normalizedPath = row.path.replace(/\\/g, '/');
    const filePath = path.join(__dirname, 'public', normalizedPath);
    console.log('Serving video from path:', filePath);
    console.log('Video exists:', require('fs').existsSync(filePath));

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).send('Error serving video');
        }
      }
    });
  });
});

app.get('/', (req, res) => {
  db.all('SELECT id, filename, originalName, uploadDate, size, isCurrent FROM videos ORDER BY uploadDate DESC', (err, videos) => {
    if (err) {
      console.error('Error fetching videos:', err);
      return res.status(500).send('Error loading videos');
    }

    const currentVideoRaw = videos.find(v => v.isCurrent === 1) || null;
    const currentVideo = currentVideoRaw ? {
      id: currentVideoRaw.id.toString(),
      filename: currentVideoRaw.filename,
      originalName: currentVideoRaw.originalName,
      uploadDate: currentVideoRaw.uploadDate,
      size: currentVideoRaw.size,
      path: `/video/${currentVideoRaw.id}`
    } : null;

    const uploadedVideos = videos.map(v => ({
      id: v.id.toString(),
      filename: v.filename,
      originalName: v.originalName,
      uploadDate: v.uploadDate,
      size: v.size,
      path: `/video/${v.id}`
    }));

    res.render('index', { videoData: { currentVideo, uploadedVideos } });
  });
});

app.get('/admin', adminAuth, (req, res) => {
  db.all('SELECT id, filename, originalName, uploadDate, size, isCurrent FROM videos ORDER BY uploadDate DESC', (err, videos) => {
    if (err) {
      console.error('Error fetching videos:', err);
      return res.status(500).send('Error loading videos');
    }

    const currentVideo = videos.find(v => v.isCurrent === 1) || null;
    const uploadedVideos = videos.map(v => ({
      id: v.id.toString(),
      filename: v.filename,
      originalName: v.originalName,
      uploadDate: v.uploadDate,
      size: v.size,
      path: `/video/${v.id}`
    }));

    res.render('admin', { videoData: { currentVideo, uploadedVideos } });
  });
});

app.post('/upload', adminAuth, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const filePath = path.join('uploads', req.file.filename);

  const newVideo = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploadDate: new Date().toISOString(),
    size: req.file.size,
    path: filePath,
    isCurrent: 1
  };

  // First, set all videos to not current
  db.run('UPDATE videos SET isCurrent = 0', (err) => {
    if (err) {
      console.error('Error resetting current video:', err);
      return res.status(500).json({ error: 'Failed to update current video' });
    }

    // Insert new video as current
    db.run('INSERT INTO videos (filename, originalName, uploadDate, size, path, isCurrent) VALUES (?, ?, ?, ?, ?, ?)',
      [newVideo.filename, newVideo.originalName, newVideo.uploadDate, newVideo.size, newVideo.path, newVideo.isCurrent],
      function(err) {
        if (err) {
          console.error('Error inserting video:', err);
          return res.status(500).json({ error: 'Failed to save video data' });
        }

        newVideo.id = this.lastID.toString();

        res.json({
          success: true,
          message: 'Video uploaded successfully! Processing may take a few minutes.',
          video: newVideo
        });
      });
  });
});

app.post('/set-current-video/:videoId', adminAuth, (req, res) => {
  const videoId = parseInt(req.params.videoId);

  // First, check if the video exists
  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, row) => {
    if (err) {
      console.error('Error finding video:', err);
      return res.status(500).json({ error: 'Failed to find video' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Set all videos to not current
    db.run('UPDATE videos SET isCurrent = 0', (err) => {
      if (err) {
        console.error('Error resetting current video:', err);
        return res.status(500).json({ error: 'Failed to update current video' });
      }

      // Set the selected video as current
      db.run('UPDATE videos SET isCurrent = 1 WHERE id = ?', [videoId], (err) => {
        if (err) {
          console.error('Error setting current video:', err);
          return res.status(500).json({ error: 'Failed to set current video' });
        }

        res.json({ success: true, message: 'Current video updated successfully' });
      });
    });
  });
});

app.delete('/delete-video/:videoId', adminAuth, (req, res) => {
  const videoId = parseInt(req.params.videoId);

  // First get the video path to delete the file
  db.get('SELECT path FROM videos WHERE id = ?', [videoId], (err, row) => {
    if (err) {
      console.error('Error finding video:', err);
      return res.status(500).json({ error: 'Failed to find video' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Delete the physical file (normalize path for Windows)
    const normalizedPath = row.path.replace(/\\/g, '/');
    const filePath = path.join(__dirname, 'public', normalizedPath);
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error deleting file:', unlinkErr);
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      db.run('DELETE FROM videos WHERE id = ?', [videoId], function(err) {
        if (err) {
          console.error('Error deleting video:', err);
          return res.status(500).json({ error: 'Failed to delete video' });
        }

        res.json({ success: true, message: 'Video deleted successfully' });
      });
    });
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server accessible at http://0.0.0.0:${PORT}`);
  console.log(`Find your IP address and access from mobile: http://YOUR_IP_ADDRESS:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

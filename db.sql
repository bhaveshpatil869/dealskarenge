-- Create videos table to manage video uploads, deletions, and edits
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  originalName TEXT NOT NULL,
  uploadDate TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  isCurrent BOOLEAN DEFAULT 0
);

-- Create website_data table to store website name and other key-value data
CREATE TABLE IF NOT EXISTS website_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT
);

-- Insert default website name if not exists
INSERT OR IGNORE INTO website_data (key, value) VALUES ('website_name', 'My Video Website');

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.all("SELECT id, filename, path, isCurrent FROM videos ORDER BY uploadDate DESC LIMIT 5", (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Recent videos in database:');
    rows.forEach(row => {
      console.log(`ID: ${row.id}, Filename: ${row.filename}, Path: ${row.path}, Current: ${row.isCurrent}`);
    });
  }
  db.close();
});

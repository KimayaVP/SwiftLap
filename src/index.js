const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log('\n🏊 SwiftLapLogic is running!');
  console.log(`Open your browser: http://localhost:${PORT}\n`);
});

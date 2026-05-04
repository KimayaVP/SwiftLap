require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Mount all API routes under /api. Each router contains its own
// path prefix (e.g. /goals, /watch) so the mount point is just /api.
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/achievements'));
app.use('/api', require('./routes/coach'));
app.use('/api', require('./routes/leaderboard'));
app.use('/api', require('./routes/insights'));
app.use('/api', require('./routes/training'));
app.use('/api', require('./routes/times'));
app.use('/api', require('./routes/goals'));
app.use('/api', require('./routes/video'));
app.use('/api', require('./routes/requests'));
app.use('/api', require('./routes/groups'));
app.use('/api', require('./routes/batches'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/comments'));
app.use('/api', require('./routes/coachBadges'));
app.use('/api', require('./routes/meets'));
app.use('/api', require('./routes/watch'));

app.listen(PORT, () => console.log(`\n🏊 SwiftLapLogic at http://localhost:${PORT}\n`));

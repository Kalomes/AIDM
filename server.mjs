import express from 'express';
import { spawn } from 'child_process';
const app = express();

app.use(express.static('public'));

// Auto-start bot
spawn('node', ['agent.mjs'], { stdio: 'inherit' });

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.listen(3000, () => {
  console.log('🌐 LIVE: https://your-site.vercel.app');
  console.log('🤖 Bot auto-started');
});

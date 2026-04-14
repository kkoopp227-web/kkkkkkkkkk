const { collection, onSnapshot, doc, updateDoc, getDoc } = require('firebase/firestore');
const { db } = require('./firebase.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOTS_DIR = path.join(__dirname, 'bots-data');

// Ensure parent dir exists
if (!fs.existsSync(BOTS_DIR)) {
  fs.mkdirSync(BOTS_DIR, { recursive: true });
}

// Map to track running child processes: botId -> { process, logCache }
const runningProcesses = new Map();
const startingBots = new Set();

// === Start the System Notification Bot in the background ===
const { fork } = require('child_process');
const systemBotProc = fork(path.join(__dirname, 'system.bot.js'), [], {
    env: { ...process.env }
});

systemBotProc.on('error', (err) => {
    console.error('❌ System Bot Process Error:', err);
});
systemBotProc.on('exit', (code) => {
    console.warn(`⚠️ System Bot Process exited with code ${code}. Restarting...`);
    // Optionally restart logic here
});

// Helper: Push a new log to a bot in Firestore
const appendLog = async (botId, type, text) => {
  try {
    const botRef = doc(db, 'bots', botId);
    const botSnap = await getDoc(botRef);
    if (!botSnap.exists()) return;
    const currentLogs = botSnap.data().logs || [];
    currentLogs.push({ type, text: `[${new Date().toLocaleTimeString()}] ${text}` });
    
    // Keep only last 50 logs to avoid huge document sizes
    const trimmedLogs = currentLogs.slice(-50);
    await updateDoc(botRef, { logs: trimmedLogs });
  } catch (err) {
    console.error(`Error appending log for ${botId}:`, err);
  }
};

const startBot = async (botId, botData) => {
  console.log(`Starting bot ${botId}...`);
  if (runningProcesses.has(botId)) return; // Already running
  if (startingBots.has(botId)) return; // Already processing this start request
  
  startingBots.add(botId);

  const files = botData.files || [];
  
  // 1. Check if files exist at all
  if (files.length === 0) {
    await appendLog(botId, 'error', '❌ خطأ: لا توجد ملفات. الرجاء رفع ملفات البوت أولاً لتشغيله.');
    await updateDoc(doc(db, 'bots', botId), { status: 'error' });
    startingBots.delete(botId);
    return;
  }

  // 2. Announce checking log
  await appendLog(botId, 'info', `🔎 جاري فحص ملفات البوت المرفوعة في السجلات...`);

  const botDir = path.join(BOTS_DIR, botId);
  if (!fs.existsSync(botDir)) fs.mkdirSync(botDir, { recursive: true });

  let mainFile = '';

  files.forEach(f => {
    const fullPath = path.join(botDir, f.name);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, f.content || '');
    
    if (f.name.endsWith('index.js') || f.name.endsWith('main.js') || f.name.endsWith('bot.js') || f.name.endsWith('main.py')) {
      if (!mainFile || f.name === 'index.js' || f.name === 'main.py') {
        mainFile = f.name;
      }
    }
  });

  if (!mainFile) {
    const rootTarget = files.find(f => !f.name.includes('/') && (f.name.endsWith('.js') || f.name.endsWith('.py')));
    mainFile = rootTarget ? rootTarget.name : null;
  }

  if (!mainFile) {
    await appendLog(botId, 'error', '❌ خطأ: الملفات غير مكتملة. لم أتمكن من العثور على ملف التشغيل الأساسي (index.js أو main.py).');
    await updateDoc(doc(db, 'bots', botId), { status: 'error' });
    startingBots.delete(botId);
    return;
  }

  await appendLog(botId, 'warn', '...تم الفحص بنجاح. جاري تهيئة البوت للإقلاع ونقله للسيرفر.');

  // Spawn the Child Process instantly
  const command = mainFile.endsWith('.py') ? 'python' : 'node';
  const proc = spawn(command, [mainFile], { cwd: botDir });
  runningProcesses.set(botId, { process: proc });
  startingBots.delete(botId);

  await updateDoc(doc(db, 'bots', botId), { status: 'active' });
  await appendLog(botId, 'success', '🚀 اشتغل البوت! متصل الآن.');

  proc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) appendLog(botId, 'info', `Terminal: ${text}`);
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) appendLog(botId, 'error', `${text}`);
  });

  proc.on('close', async (code) => {
    runningProcesses.delete(botId);
    try {
        const checkDoc = await getDoc(doc(db, 'bots', botId));
        if (checkDoc.exists() && checkDoc.data().status === 'active') {
            await appendLog(botId, 'error', `⚠️ توقف البوت بشكل غير متوقع (الكود: ${code}).`);
            await updateDoc(doc(db, 'bots', botId), { status: 'error' });
        }
    } catch(e) {}
  });
};

const stoppingBots = new Set();

const stopBotWithCountdown = async (botId) => {
  if (!runningProcesses.has(botId)) {
    // If not running locally, just mark offline
    await updateDoc(doc(db, 'bots', botId), { status: 'offline' });
    return;
  }
  if (stoppingBots.has(botId)) return;
  stoppingBots.add(botId);

  let countdown = 3;
  const stopInterval = setInterval(async () => {
    if (countdown > 0) {
      await appendLog(botId, 'warn', `🛑 إيقاف البوت خلال: ${countdown} ثواني...`);
      countdown--;
    } else {
      clearInterval(stopInterval);
      const procObj = runningProcesses.get(botId);
      if (procObj && procObj.process) {
         procObj.process.kill();
      }
      runningProcesses.delete(botId);
      stoppingBots.delete(botId);
      
      await appendLog(botId, 'info', 'تم الإيقاف وفصل السيرفر متعمداً.');
      await updateDoc(doc(db, 'bots', botId), { status: 'offline' });
    }
  }, 1000);
};

// Start listening continuously to firestore
onSnapshot(collection(db, 'bots'), (snapshot) => {
  console.log(`Received snapshot with ${snapshot.docChanges().length} changes.`);
  snapshot.docChanges().forEach((change) => {
    const botId = change.doc.id;
    const botData = change.doc.data();
    
    if (change.type === 'added' || change.type === 'modified') {
      const status = botData.status;

      // Start Bot logic
      if (status === 'starting' && !runningProcesses.has(botId)) {
        startBot(botId, botData);
      }
      
      // Stop Bot logic
      if (status === 'stopping' && runningProcesses.has(botId)) {
         stopBotWithCountdown(botId);
      }
    }
    
    if (change.type === 'removed') {
      if (runningProcesses.has(botId)) {
        const procObj = runningProcesses.get(botId);
        if (procObj && procObj.process) procObj.process.kill();
        runningProcesses.delete(botId);
      }
      
      const botDir = path.join(BOTS_DIR, botId);
      if (fs.existsSync(botDir)) {
        try {
          fs.rmSync(botDir, { recursive: true, force: true });
          console.log(`Deleted files for removed bot: ${botId}`);
        } catch (err) {
          console.error(`Error deleting files for bot ${botId}:`, err);
        }
      }
    }
  });
}, (error) => {
  console.error("Firestore snapshot error:", error);
});

console.log("✅ Bot Runner is listening for starting bots on Firestore...");

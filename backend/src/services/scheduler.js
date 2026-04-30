const cron = require('node-cron');
const { runScheduledRefresh } = require('./dataSync');

let task = null;

function startScheduler() {
  const minutes = Math.max(1, parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 5);
  const expr = minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;

  task = cron.schedule(expr, async () => {
    console.log(`[${new Date().toISOString()}] Rafraîchissement planifié démarré`);
    try {
      await runScheduledRefresh();
      console.log(`[${new Date().toISOString()}] Rafraîchissement terminé`);
    } catch (err) {
      console.error('Erreur scheduler:', err.message);
    }
  });

  console.log(`Scheduler démarré (intervalle : ${minutes} minute(s))`);
}

function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { startScheduler, stopScheduler };

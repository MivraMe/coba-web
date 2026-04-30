const cron = require('node-cron');
const { runScheduledRefresh } = require('./dataSync');

let task = null;
let intervalMinutes = null;
let lastRunAt = null;
let nextRunAt = null;

function startScheduler() {
  intervalMinutes = Math.max(1, parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 5);
  const expr = intervalMinutes === 1 ? '* * * * *' : `*/${intervalMinutes} * * * *`;

  task = cron.schedule(expr, async () => {
    lastRunAt = new Date();
    _updateNextRun();
    console.log(`[${lastRunAt.toISOString()}] Rafraîchissement planifié démarré`);
    try {
      await runScheduledRefresh();
      console.log(`[${new Date().toISOString()}] Rafraîchissement terminé`);
    } catch (err) {
      console.error('Erreur scheduler:', err.message);
    }
  });

  _updateNextRun();
  console.log(`Scheduler démarré (intervalle : ${intervalMinutes} minute(s))`);
}

function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}

function restartScheduler() {
  stopScheduler();
  startScheduler();
}

function getSchedulerStatus() {
  return {
    active: task !== null,
    intervalMinutes,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
  };
}

function _updateNextRun() {
  if (!intervalMinutes) return;
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  // Round up to next interval boundary
  const mins = next.getMinutes();
  const rem = intervalMinutes - (mins % intervalMinutes);
  next.setMinutes(mins + rem);
  nextRunAt = next;
}

module.exports = { startScheduler, stopScheduler, restartScheduler, getSchedulerStatus };

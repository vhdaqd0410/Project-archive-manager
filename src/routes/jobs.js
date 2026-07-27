// 后台任务系统：创建、进度更新、状态查询、取消

const crypto = require('crypto');
const runningJobs = {};

function createJob(projectId, projectName, totalItems, type) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId, projectId, projectName, type, totalItems,
    current: 0, completed: 0, failed: 0, skipped: 0,
    status: 'pending', startTime: null, endTime: null,
    items: new Array(totalItems).fill({ name: '', state: 'pending' }),
    cancel: false
  };
  runningJobs[jobId] = job;
  const keys = Object.keys(runningJobs);
  if (keys.length > 20) {
    const doneKeys = keys.filter(k => runningJobs[k].status === 'done');
    for (const k of doneKeys.slice(0, doneKeys.length - 5)) delete runningJobs[k];
  }
  return job;
}

function updateJobProgress(job, idx, itemName, result) {
  job.current = idx + 1;
  job.items[idx] = { name: itemName, state: result };
  if (result === 'ok') job.completed++;
  else if (result === 'skip') job.skipped++;
  else if (result === 'fail') job.failed++;
}

function finishJob(job, status, resultData) {
  job.status = status;
  job.endTime = Date.now();
  Object.assign(job, resultData);
}

function getJob(jobId) { return runningJobs[jobId] || null; }

// 挂在 Express router 上
function mountJobRoutes(router) {
  router.get('/jobs/:jobId', (req, res) => {
    const job = runningJobs[req.params.jobId];
    if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
    res.json({
      id: job.id, projectName: job.projectName, type: job.type,
      totalItems: job.totalItems, current: job.current,
      completed: job.completed, failed: job.failed, skipped: job.skipped,
      status: job.status, nasDir: job.nasDir || '',
      totalBytes: job.totalBytes || 0,
      currentItem: job.current <= job.totalItems ? (job.items[job.current - 1] || {}) : {},
      elapsed: job.startTime ? ((job.endTime || Date.now()) - job.startTime) : 0
    });
  });

  router.post('/jobs/:jobId/cancel', (req, res) => {
    const job = runningJobs[req.params.jobId];
    if (!job) return res.status(404).json({ error: '任务不存在' });
    if (job.status !== 'pending' && job.status !== 'running') return res.status(400).json({ error: '任务已完成，无法取消' });
    job.cancel = true;
    res.json({ success: true });
  });
}

module.exports = { createJob, updateJobProgress, finishJob, getJob, mountJobRoutes };

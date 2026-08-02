// 所有路由的共享状态

const projectService = require('../services/projectService');
const crypto = require('crypto');

const projects = projectService.loadProjects();
const settings = projectService.loadSettings();

// 初始化默认值
projects.forEach(p => {
  if (!p.status) p.status = 'editing';
  if (!p.id) p.id = crypto.randomUUID();
  if (!p.memo) p.memo = '';
  if (!p.episodeTarget) p.episodeTarget = 0;
  if (!p.episodeAssignments) p.episodeAssignments = [];
});

function findIndexById(id) {
  return projects.findIndex(p => p.id === id);
}

function getProjectById(id) {
  const idx = findIndexById(id);
  return idx >= 0 ? { project: projects[idx], index: idx } : null;
}

module.exports = { projects, settings, findIndexById, getProjectById };

/**
 * 轻量级输入验证中间件
 * 声明式定义校验规则，避免手写 if-else
 */
const config = require('../config');

/**
 * 创建一个验证中间件
 * @param {Object} rules - 校验规则 { field: { required, type, message, pattern, validate } }
 * @returns {Function} Express 中间件
 *
 * 示例：
 *   validate({ name: { required: true, message: '名称不能为空' } })
 */
function validate(rules = {}) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const value = req.body[field];

      // 必填检查
      if (rule.required) {
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
          errors.push(rule.message || `${field} 不能为空`);
          continue;
        }
      }

      // 跳过后续检查（值为空且非必填）
      if (value === undefined || value === null || value === '') continue;

      // 类型检查
      if (rule.type === 'string' && typeof value !== 'string') {
        errors.push(rule.message || `${field} 必须是字符串`);
        continue;
      }
      if (rule.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
        errors.push(rule.message || `${field} 必须是数字`);
        continue;
      }
      if (rule.type === 'array' && !Array.isArray(value)) {
        errors.push(rule.message || `${field} 必须是数组`);
        continue;
      }
      if (rule.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(rule.message || `${field} 必须是布尔值`);
        continue;
      }

      // 正则匹配
      if (rule.pattern && !rule.pattern.test(String(value))) {
        errors.push(rule.message || `${field} 格式不正确`);
        continue;
      }

      // 枚举值
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(rule.message || `${field} 值无效`);
        continue;
      }

      // 自定义校验
      if (rule.validate && !rule.validate(value, req.body)) {
        errors.push(rule.message || `${field} 校验失败`);
        continue;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], errors });
    }

    next();
  };
}

// ── 常用预设规则 ──
const presets = {
  projectName: { required: true, type: 'string', message: '项目名称不能为空' },
  projectStatus: { required: true, type: 'string', enum: config.validStatuses, message: '无效的项目状态' },
  keyword: { type: 'string', message: '关键词格式不正确' },
  fileNames: { required: true, type: 'array', message: '文件列表不能为空' },
  batchNames: { required: true, type: 'array', message: '批次列表不能为空' },
  localDir: { type: 'string', message: '本地目录格式不正确' },
  nasDir: { type: 'string', message: 'NAS目录格式不正确' },
  episodeTarget: { type: 'number', message: '目标集数必须是数字' },
  episodeAssignments: { type: 'array', message: '集数分配必须是数组' },
  items: { required: true, type: 'array', message: '导入项列表不能为空' },
  templates: { required: true, type: 'array', message: '模板列表不能为空且必须是数组' },
};

module.exports = { validate, presets };

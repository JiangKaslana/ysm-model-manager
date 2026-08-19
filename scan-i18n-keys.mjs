import fs from 'fs';
import path from 'path';

const capsDir = 'C:/Users/zhujieling11/ysm-model-manager/frontend/src/utils/3d/caps';
const localeDir = 'C:/Users/zhujieling11/ysm-model-manager/frontend/src/core/i18n/locales';

const capFiles = fs.readdirSync(capsDir)
  .filter(f => f.endsWith('-capability.ts') && !f.endsWith('.test.ts'))
  .map(f => path.join(capsDir, f));

const refs = new Set();
capFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  content.replace(/labelKey:\s*"([^"]+)"/g, (_, k) => refs.add(k));
  content.replace(/descKey:\s*"([^"]+)"/g, (_, k) => refs.add(k));
  content.replace(/group:\s*"([^"]+)"/g, (_, k) => refs.add(k));
  content.replace(/hintKey:\s*"([^"]+)"/g, (_, k) => refs.add(k));
});

const locales = ['zh-CN','en','ja'];
const defined = new Set();
locales.forEach(lang => {
  const f = path.join(localeDir, lang+'.ts');
  const content = fs.readFileSync(f, 'utf8');
  content.replace(/"(preview\.[^"]+)"/g, (_, k) => defined.add(k));
});

const missing = [...refs].filter(k => !defined.has(k)).sort();
console.log('总引用数:', refs.size);
console.log('总定义数:', defined.size);
console.log('缺失数:', missing.length);
if (missing.length > 0) {
  console.log('\n缺失 key 列表:');
  missing.forEach(k => console.log('  ' + k));
}
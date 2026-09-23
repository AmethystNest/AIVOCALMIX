const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(name);
    else if (name.endsWith('.js')) new vm.Script(fs.readFileSync(name, 'utf8'));
  }
}
checkDirectory(path.join(root, 'src'));
new vm.Script(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'));
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate IDs: ${duplicates.join(', ')}`);
console.log('JS syntax PASS; duplicate IDs 0');

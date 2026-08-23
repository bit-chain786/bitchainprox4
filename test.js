const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');
console.log(html.includes('<div class="stat-icon red">??</div>'));

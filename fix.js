const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');

// The file might currently contain ?? or strange chars.
// We will just do a blind checkout of the original file, 
// then apply all our changes to it in memory, and save it!

import { migrate } from '../src/db.js';
const applied = migrate();
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');

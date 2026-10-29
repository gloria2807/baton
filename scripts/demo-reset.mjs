// Puts the demo sites back into their starting state. Later stages also reset the profile and Podium.
try {
  const r = await fetch('http://127.0.0.1:4400/__reset', { method: 'POST' });
  console.log(`demo sites reset (${r.status})`);
} catch {
  console.error('demo sites are not running; start them with: npm run demo-sites');
  process.exit(1);
}

#!/usr/bin/env node
// seed.js — generate ~2000 random messages spread over the last 30 days.
// Run once with `node seed.js`. Preserves messages already in messages.json.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'messages.json');
const COUNT = 2000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const NOW = Date.now();

const openers = [
  'hello from', 'greetings,', 'just dropping in to say', 'random thought:',
  'today i learned', 'unpopular opinion:', 'note to self:', 'reminder:',
  'overheard:', 'fun fact:', 'shower thought:', 'pro tip:', 'breaking:',
  'late-night idea:', 'morning brain:', 'confession time —', 'hot take:',
  'PSA:', 'midnight musings:', 'caffeine-fuelled idea:',
];

const subjects = [
  'the wall', 'this place', 'monospace fonts', 'the terminal', 'green-on-black',
  'CRT vibes', 'lazy loading', 'web sockets', 'JSON files', 'tabs vs spaces',
  'vim', 'emacs', 'side projects', 'rubber ducks', 'small servers',
  'static sites', 'plain HTML', 'JS without a build step', 'CSS grid',
  'flexbox', 'dark mode', 'old computers', 'mechanical keyboards',
  'split keyboards', 'tmux', 'screen', 'cron jobs', 'shell scripts',
  'regular expressions', 'datetime arithmetic', 'unicode', 'emoji',
  'feeds and RSS', 'finger protocol', 'IRC', 'BBSs', 'gopher', 'usenet',
  'the small web', 'minimalism', 'plain text', 'markdown', 'plain text wins',
  'message boards', 'guestbooks', 'wikis', 'self-hosting', 'static blogs',
  'no frameworks', 'just shipping it',
];

const verbs = [
  'is underrated', 'still rules', 'is having a moment', 'never went away',
  'should make a comeback', 'is a vibe', 'is cozy', 'is comfy',
  'feels right', 'is the answer', 'beats every framework', 'wins again',
  'changed my life', 'is the way', 'sparks joy', 'is criminally overlooked',
  'is the only path forward', 'has been the answer all along',
];

const tails = [
  '', '', '', '',
  ' fight me.', ' change my mind.', ' you can quote me on it.',
  ' that is all.', ' carry on.', ' do not @ me.', ' just saying.',
  ' anyway, bye.', ' see you tomorrow.', ' that\'s it, that\'s the post.',
  ' i\'ll see myself out.', ' love this place.', ' more please.',
  ' :)', ' :D', ' o7', ' <3', ' :wave:', ' ★', ' ✨',
];

const lyrics = [
  'lorem ipsum dolor sit amet',
  'the quick brown fox jumps over the lazy dog',
  'sphinx of black quartz, judge my vow',
  'all your base are belong to us',
  'hello world',
  'console.log("yo")',
  'curl localhost:3000 | jq',
  'echo $PATH',
  'rm -rf node_modules && npm i',
  'git push --force-with-lease',
  'TODO: write better TODOs',
  'works on my machine',
  'it compiles, ship it',
  'have you tried turning it off and on again',
  'always be commiting',
  'commit early, commit often',
  'measure twice, cut once',
  'do one thing and do it well',
  'cat /dev/urandom | head -c 64',
  'awk \'{print $1}\'',
];

const haikus = [
  'cold green pixels glow\nan empty wall waiting for\nthe first kind message',
  'monospace at dusk\nthe cursor blinks, patient still\nsomeone types: hello',
  'JSON on disk\na simple flat file remembers\neverything you said',
  'horizontal scroll\nnewspaper of strangers\'\nthoughts kept warm by code',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomLine() {
  const r = Math.random();
  if (r < 0.10) return pick(haikus);
  if (r < 0.30) return pick(lyrics);
  // template: "<opener> <subject> <verb><tail>"
  let s = '';
  if (Math.random() < 0.7) s += pick(openers) + ' ';
  s += pick(subjects) + ' ' + pick(verbs);
  if (Math.random() < 0.6) s += pick(tails);
  // occasional second sentence
  if (Math.random() < 0.25) {
    s += ' ' + pick(openers) + ' ' + pick(subjects) + ' ' + pick(verbs) + pick(tails);
  }
  return s.trim();
}

function randomId(ts) {
  return `${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

let existing = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) existing = parsed;
  }
} catch (err) {
  console.error('Could not read existing messages.json, starting fresh:', err.message);
}

const generated = [];
for (let i = 0; i < COUNT; i++) {
  // weight toward more-recent so the wall feels alive near the start
  const u = Math.random();
  const skew = u * u; // bias toward 0 (newer)
  const ageMs = skew * MONTH_MS;
  const ts = NOW - ageMs;
  generated.push({
    id: randomId(Math.floor(ts)),
    text: randomLine(),
    createdAt: new Date(ts).toISOString(),
  });
}

const all = existing.concat(generated);
all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

fs.writeFileSync(DATA_FILE, JSON.stringify(all));
console.log(`[seed] wrote ${all.length} messages (${existing.length} preserved + ${generated.length} new) to ${DATA_FILE}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyDir = path.join(root, 'data', 'history');
const seasons = new Map();
const careers = new Map();

function seasonRecord(name) {
  if (!seasons.has(name)) seasons.set(name, { appearances: 0, curlers: new Set(), events: new Map() });
  return seasons.get(name);
}

for (const file of fs.readdirSync(historyDir).filter(name => name.endsWith('.json')).sort()) {
  const payload = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
  const association = payload.source_subdomain;
  for (const [curlerId, rows] of Object.entries(payload.curler_appearances)) {
    for (const row of rows) {
      const seasonName = row.season || 'Season not labelled';
      const scopedId = `${association}:${curlerId}`;
      const eventKey = `${association}:${row.event_id}`;
      const season = seasonRecord(seasonName);
      season.appearances++;
      season.curlers.add(scopedId);
      season.events.set(eventKey, {
        name: row.event_name || 'Recorded event',
        starts_on: row.starts_on || '',
        ends_on: row.ends_on || '',
        association: association.toUpperCase(),
        source_url: `https://${association}.curling.io/en/events/${row.event_id}`
      });
      if (!careers.has(scopedId)) careers.set(scopedId, { name: '', association, seasons: new Set(), events: new Set() });
      const career = careers.get(scopedId);
      career.name = row.published_name || career.name;
      career.seasons.add(seasonName);
      career.events.add(eventKey);
    }
  }
}

const seasonRows = [...seasons.entries()].map(([season, values]) => ({
  season,
  events: values.events.size,
  curlers: values.curlers.size,
  appearances: values.appearances,
  recent_events: [...values.events.values()]
    .sort((a, b) => Date.parse(b.starts_on) - Date.parse(a.starts_on))
    .slice(0, 12)
})).sort((a, b) => b.season.localeCompare(a.season));

const candidates = [...careers.values()]
  .filter(row => row.name && row.events.size >= 4 && row.seasons.size >= 2)
  .map(row => ({ name: row.name, association: row.association.toUpperCase(), events: row.events.size, seasons: row.seasons.size }))
  .sort((a, b) => b.seasons - a.seasons || b.events - a.events || a.name.localeCompare(b.name));
const featured = [];
const usedAssociations = new Set();
for (const row of candidates) {
  if (usedAssociations.has(row.association)) continue;
  featured.push(row);
  usedAssociations.add(row.association);
  if (featured.length === 8) break;
}

const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source_provider: 'Curling I/O',
  coverage_note: 'Published roster appearances from current and two prior seasons. Coverage varies by association and event.',
  default_season: seasonRows.reduce((best, row) => row.appearances > best.appearances ? row : best, seasonRows[0])?.season || '',
  seasons: seasonRows,
  featured_curlers: featured
};
fs.writeFileSync(path.join(root, 'data', 'home-summary.json'), JSON.stringify(output));
console.log(`Wrote ${seasonRows.length} seasons, ${seasonRows.reduce((sum, row) => sum + row.events, 0)} events and ${featured.length} examples`);

import { resolve } from 'node:path';
import { createEpetServer } from './app';

const port = Math.max(1, Number(process.env.PORT) || 8787);
const dataFile = resolve(
  process.env.EPET_DATA_FILE || 'server/data/epet-runtime.json',
);
const distDirectory = resolve(process.env.EPET_DIST_DIR || 'dist');
const { server } = createEpetServer({
  dataFile,
  distDirectory,
  registrationEnabled: process.env.REGISTRATION_ENABLED === 'true',
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ePet API listening on http://127.0.0.1:${port}`);
});

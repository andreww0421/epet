import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiEnvironment = {
  ...process.env,
  // `npm start` is closed by default. The explicit full local-development
  // workflow keeps first-run account creation available unless the developer
  // deliberately overrides it.
  REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED ?? 'true',
};
const children = [
  spawn(npmCommand, ['run', 'dev:api'], {
    env: apiEnvironment,
    stdio: 'inherit',
  }),
  spawn(npmCommand, ['run', 'dev'], { stdio: 'inherit' }),
];

const stop = () => {
  children.forEach((child) => child.kill());
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const exitCodes = await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0))),
  ),
);

process.exit(exitCodes.find((code) => code !== 0) ?? 0);

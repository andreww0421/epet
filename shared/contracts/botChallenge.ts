export type BotChallengeVerification = {
  token: string;
  action: 'login' | 'register' | 'forgot';
  remoteIp?: string;
  expectedHostname: string;
};

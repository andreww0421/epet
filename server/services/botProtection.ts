export class BotChallengeFailedError extends Error {
  constructor() {
    super('BOT_CHALLENGE_FAILED');
  }
}

export class BotProtectionUnavailableError extends Error {
  constructor() {
    super('BOT_PROTECTION_UNAVAILABLE');
  }
}

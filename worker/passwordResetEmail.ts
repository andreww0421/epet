import {
  hashOpaqueToken,
  type PasswordResetDelivery,
  type WorkspaceInvitationDelivery,
} from '../server/auth';

export type PasswordResetEmailEnv = {
  PASSWORD_RESET_FROM?: string;
  PUBLIC_APP_URL?: string;
  RESEND_API_KEY?: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);

export const createPasswordResetMailer = (
  env: PasswordResetEmailEnv,
) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PASSWORD_RESET_FROM?.trim();
  const publicAppUrl = env.PUBLIC_APP_URL?.trim().replace(/\/?$/, '/');
  if (!apiKey || !from || !publicAppUrl) return undefined;

  return async (delivery: PasswordResetDelivery) => {
    const resetUrl = `${publicAppUrl}#/reset-password?token=${encodeURIComponent(delivery.token)}`;
    const expiresInMinutes = Math.max(
      1,
      Math.round((delivery.expiresAt - Date.now()) / 60_000),
    );
    const safeName = escapeHtml(delivery.displayName);
    const safeResetUrl = escapeHtml(resetUrl);
    const tokenHash = await hashOpaqueToken(delivery.token);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `epet-password-reset-${tokenHash}`,
      },
      body: JSON.stringify({
        from,
        to: [delivery.email],
        subject: '重設你的 ePet 密碼',
        text: [
          `${delivery.displayName} 您好：`,
          '',
          `請在 ${expiresInMinutes} 分鐘內開啟以下連結重設密碼：`,
          resetUrl,
          '',
          '若你沒有提出此要求，可以忽略這封信；系統不會透過郵件索取密碼。',
        ].join('\n'),
        html: [
          `<p>${safeName} 您好：</p>`,
          `<p>請在 ${expiresInMinutes} 分鐘內重設密碼。</p>`,
          `<p><a href="${safeResetUrl}">重設 ePet 密碼</a></p>`,
          '<p>若你沒有提出此要求，可以忽略這封信；系統不會透過郵件索取密碼。</p>',
        ].join(''),
      }),
    });
    if (!response.ok) {
      throw new Error('PASSWORD_RESET_EMAIL_FAILED');
    }
  };
};

export const createWorkspaceInvitationMailer = (
  env: PasswordResetEmailEnv,
) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PASSWORD_RESET_FROM?.trim();
  const publicAppUrl = env.PUBLIC_APP_URL?.trim().replace(/\/?$/, '/');
  if (!apiKey || !from || !publicAppUrl) return undefined;

  return async (delivery: WorkspaceInvitationDelivery) => {
    const invitationUrl = `${publicAppUrl}#/accept-invitation?token=${encodeURIComponent(delivery.token)}`;
    const safeWorkspaceName = escapeHtml(delivery.workspaceName);
    const safeInvitationUrl = escapeHtml(invitationUrl);
    const expiresInDays = Math.max(
      1,
      Math.ceil((delivery.expiresAt - Date.now()) / 86_400_000),
    );
    const tokenHash = await hashOpaqueToken(delivery.token);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `epet-invitation-${tokenHash}`,
      },
      body: JSON.stringify({
        from,
        to: [delivery.email],
        subject: `你已受邀加入 ${delivery.workspaceName}`,
        text: [
          `你已受邀以 ${delivery.role} 身分加入「${delivery.workspaceName}」。`,
          '',
          `請在 ${expiresInDays} 天內開啟以下連結：`,
          invitationUrl,
          '',
          '若你不認識此工作區，請忽略這封信。',
        ].join('\n'),
        html: [
          `<p>你已受邀以 <strong>${escapeHtml(delivery.role)}</strong> 身分加入「${safeWorkspaceName}」。</p>`,
          `<p>請在 ${expiresInDays} 天內完成加入。</p>`,
          `<p><a href="${safeInvitationUrl}">接受 ePet 工作區邀請</a></p>`,
          '<p>若你不認識此工作區，請忽略這封信。</p>',
        ].join(''),
      }),
    });
    if (!response.ok) throw new Error('WORKSPACE_INVITATION_EMAIL_FAILED');
  };
};

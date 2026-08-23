import {
  hashOpaqueToken,
  type AccountLifecycleDelivery,
  type EmailVerificationDelivery,
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

export const createEmailVerificationMailer = (
  env: PasswordResetEmailEnv,
) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PASSWORD_RESET_FROM?.trim();
  const publicAppUrl = env.PUBLIC_APP_URL?.trim().replace(/\/?$/, '/');
  if (!apiKey || !from || !publicAppUrl) return undefined;

  return async (delivery: EmailVerificationDelivery) => {
    const verificationUrl =
      `${publicAppUrl}#/verify-email?token=${encodeURIComponent(delivery.token)}`;
    const expiresInHours = Math.max(
      1,
      Math.ceil((delivery.expiresAt - Date.now()) / 3_600_000),
    );
    const tokenHash = await hashOpaqueToken(delivery.token);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `epet-email-verification-${tokenHash}`,
      },
      body: JSON.stringify({
        from,
        to: [delivery.email],
        subject: '驗證你的 ePet Email',
        text: [
          `${delivery.displayName} 您好：`,
          '',
          `請在 ${expiresInHours} 小時內驗證 Email：`,
          verificationUrl,
          '',
          '若你沒有建立 ePet 帳號，可以忽略這封信。',
        ].join('\n'),
        html: [
          `<p>${escapeHtml(delivery.displayName)} 您好：</p>`,
          `<p>請在 ${expiresInHours} 小時內完成 Email 驗證。</p>`,
          `<p><a href="${escapeHtml(verificationUrl)}">驗證 ePet Email</a></p>`,
          '<p>若你沒有建立 ePet 帳號，可以忽略這封信。</p>',
        ].join(''),
      }),
    });
    if (!response.ok) throw new Error('EMAIL_VERIFICATION_DELIVERY_FAILED');
  };
};

const lifecycleCopy = (delivery: AccountLifecycleDelivery) => {
  const workspace = delivery.workspaceName
    ? `「${delivery.workspaceName}」`
    : 'ePet';
  switch (delivery.kind) {
    case 'email_verified':
      return {
        subject: '你的 ePet Email 已完成驗證',
        message: '你的 Email 已完成驗證，現在可以使用工作區功能。',
      };
    case 'password_changed':
      return {
        subject: '你的 ePet 密碼已變更',
        message: '你的密碼剛剛已變更，所有既有登入工作階段已撤銷。',
      };
    case 'workspace_joined':
      return {
        subject: `你已加入 ${delivery.workspaceName ?? 'ePet 工作區'}`,
        message: `你已以 ${delivery.role ?? 'member'} 身分加入${workspace}。`,
      };
    case 'workspace_role_changed':
      return {
        subject: `${delivery.workspaceName ?? 'ePet 工作區'}角色已變更`,
        message:
          `你在${workspace}的角色已從 ${delivery.previousRole ?? 'member'} ` +
          `變更為 ${delivery.role ?? 'member'}。`,
      };
    case 'workspace_removed':
      return {
        subject: `你已離開 ${delivery.workspaceName ?? 'ePet 工作區'}`,
        message: `你的${workspace}存取權已被移除。`,
      };
    case 'ownership_transferred':
      return {
        subject: `${delivery.workspaceName ?? 'ePet 工作區'}所有權已移轉`,
        message: `你已將${workspace}所有權移轉，角色已變更為 admin。`,
      };
    case 'ownership_received':
      return {
        subject: `你已成為 ${delivery.workspaceName ?? 'ePet 工作區'}擁有者`,
        message: `你已取得${workspace}所有權。`,
      };
    case 'workspace_deleted':
      return {
        subject: `${delivery.workspaceName ?? 'ePet 工作區'}已刪除`,
        message: `${workspace}已由擁有者刪除，你的存取權也已結束。`,
      };
    case 'account_deleted':
      return {
        subject: '你的 ePet 帳號已刪除',
        message: '你的 ePet 帳號已完成刪除，既有登入工作階段已失效。',
      };
  }
};

export const createAccountLifecycleMailer = (
  env: PasswordResetEmailEnv,
) => {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PASSWORD_RESET_FROM?.trim();
  if (!apiKey || !from) return undefined;

  return async (delivery: AccountLifecycleDelivery) => {
    const copy = lifecycleCopy(delivery);
    const occurredAt = new Date(delivery.occurredAt).toISOString();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `epet-lifecycle-${delivery.eventId}`,
      },
      body: JSON.stringify({
        from,
        to: [delivery.email],
        subject: copy.subject,
        text: [
          `${delivery.displayName} 您好：`,
          '',
          copy.message,
          `時間：${occurredAt}`,
          '',
          '若這不是你預期的變更，請立即重設密碼並聯絡工作區管理員。',
        ].join('\n'),
        html: [
          `<p>${escapeHtml(delivery.displayName)} 您好：</p>`,
          `<p>${escapeHtml(copy.message)}</p>`,
          `<p>時間：${escapeHtml(occurredAt)}</p>`,
          '<p>若這不是你預期的變更，請立即重設密碼並聯絡工作區管理員。</p>',
        ].join(''),
      }),
    });
    if (!response.ok) throw new Error('ACCOUNT_LIFECYCLE_EMAIL_FAILED');
  };
};

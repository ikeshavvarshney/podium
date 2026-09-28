import { Router } from "express";
import { z } from "zod";
import { AUTH_COOKIE, config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { forbidden } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import {
  assertLoginAllowed,
  authRateLimit,
  clearLoginFailures,
  rateLimit,
  recordLoginFailure,
} from "../middleware/rate-limit.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../middleware/validate.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../services/api-token.service.js";
import { AuditAction, recordAuditSafe } from "../services/audit.service.js";
import {
  changePassword,
  consumeSignInToken,
  getMyEventRoles,
  getProfile,
  loginUser,
  registerUser,
  issueSignInToken,
  revokeSessions,
  updateProfile,
} from "../services/auth.service.js";
import {
  listSessions,
  openSession,
  reissueToken,
  revokeOtherSessions,
  revokeSession,
} from "../services/session.service.js";

const router: Router = Router();

const registerSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  name: z.string().trim().min(1, "A display name is required.").max(120),
  accountType: z.enum(["user", "organizer"]).default("user"),
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

router.post(
  "/register",
  authRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { user } = await registerUser(req.body, req.ipHash);
    const token = await openSession(user.id, req);
    res.cookie(AUTH_COOKIE, token, sessionCookieOptions());
    res.status(201).json({ user, token });
  }),
);

router.post(
  "/login",
  authRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    await assertLoginAllowed(req.body.email, req.ipHash, res);
    const { user } = await loginUser(req.body.email, req.body.password, req.ipHash).catch(async (err) => {
      if (err instanceof AppError && err.status === 401) await recordLoginFailure(req.body.email, req.ipHash);
      throw err;
    });
    await clearLoginFailures(req.body.email, req.ipHash);
    const token = await openSession(user.id, req);
    res.cookie(AUTH_COOKIE, token, sessionCookieOptions());
    res.json({ user, token });
  }),
);

/**
 * Passwordless sign-in. The response never reveals whether the address is
 * registered, and with no mail transport configured the operator collects the
 * link from the server log.
 */
const magicLinkPerAddress = rateLimit("magic-link", {
  windowMs: 15 * 60_000,
  max: 5,
  key: (req) => String(req.body?.email ?? "").trim().toLowerCase(),
  message: "A sign-in link was requested for this address several times. Try again in a few minutes.",
});

router.post(
  "/magic-link",
  authRateLimit,
  magicLinkPerAddress,
  validate({ body: z.object({ email: z.string().trim().email("Enter a valid email address.") }) }),
  asyncHandler(async (req, res) => {
    const issued = await issueSignInToken(req.body.email, req.ipHash);
    if (issued) {
      const url = `${config.PUBLIC_WEB_URL}/auth/link?token=${issued.token}`;
      console.log(`[auth] sign-in link for ${issued.user.name}: ${url}`);
    }
    res.status(202).json({
      delivered: "log",
      message: "If that address has an account, a sign-in link is on its way.",
    });
  }),
);

router.post(
  "/magic-link/consume",
  authRateLimit,
  validate({ body: z.object({ token: z.string().trim().min(10).max(200) }) }),
  asyncHandler(async (req, res) => {
    const { user } = await consumeSignInToken(req.body.token, req.ipHash);
    const token = await openSession(user.id, req);
    res.cookie(AUTH_COOKIE, token, sessionCookieOptions());
    res.json({ user });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (req.user) {
      recordAuditSafe({
        action: AuditAction.USER_LOGGED_OUT,
        actorId: req.user.id,
        targetType: "user",
        targetId: req.user.id,
        summary: `${req.user.name} signed out`,
        ipHash: req.ipHash,
      });
    }
    if (req.user && req.sessionId) {
      await revokeSession(req.user.id, req.sessionId).catch(() => undefined);
    }
    res.clearCookie(AUTH_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.status(204).end();
  }),
);

/**
 * The web client's "who is here" check. Unlike `/me`, a caller with no session is a normal
 * answer here rather than an error, so every signed-out page view is not a logged 401.
 */
router.get(
  "/session",
  asyncHandler(async (req, res) => {
    if (!req.user) {
      res.json({ user: null, events: [] });
      return;
    }
    res.json({ user: await getProfile(req.user.id), events: await getMyEventRoles(req.user.id) });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ user: await getProfile(user.id), events: await getMyEventRoles(user.id) });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(1, "A display name is required.").max(120).optional(),
  org: z.string().trim().max(120).nullish(),
  pronouns: z.string().trim().max(40).nullish(),
  bio: z.string().trim().max(600).nullish(),
  link: z.string().trim().url("Enter a full URL.").max(300).nullish(),
  avatarHue: z
    .enum(["slate", "blue", "teal", "green", "amber", "plum", "rose", "cyan", "coral"])
    .optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(10, "Use at least 10 characters.").max(200),
});

router.patch(
  "/me",
  requireAuth,
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateProfile(currentUser(req).id, req.body, req.ipHash));
  }),
);

router.post(
  "/password",
  requireAuth,
  authRateLimit,
  validate({ body: passwordSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await changePassword(user.id, req.body.currentPassword, req.body.newPassword, req.ipHash);
    await revokeOtherSessions(user.id, req.sessionId);
    res.cookie(AUTH_COOKIE, await reissueToken(user.id, req), sessionCookieOptions());
    res.status(204).end();
  }),
);

router.post(
  "/sessions/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await revokeSessions(user.id, req.ipHash);
    await revokeOtherSessions(user.id, req.sessionId);
    res.cookie(AUTH_COOKIE, await reissueToken(user.id, req), sessionCookieOptions());
    res.status(204).end();
  }),
);

router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listSessions(currentUser(req).id, req.sessionId));
  }),
);

router.delete(
  "/sessions/:sessionId",
  requireAuth,
  validate({ params: z.object({ sessionId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await revokeSession(user.id, req.params.sessionId as string);
    recordAuditSafe({
      action: AuditAction.USER_SESSIONS_REVOKED,
      actorId: user.id,
      targetType: "session",
      targetId: req.params.sessionId as string,
      summary: `${user.name} signed out one device`,
      ipHash: req.ipHash,
    });
    res.status(204).end();
  }),
);

/** The caller's own recent actions, read from the audit log. */
router.get(
  "/me/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await prisma.auditLog.findMany({
      where: { actorId: currentUser(req).id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, action: true, summary: true, createdAt: true, eventId: true },
    });
    res.json(entries);
  }),
);

const prefsSchema = z.object({
  judgingReminders: z.boolean().optional(),
  resultsPublished: z.boolean().optional(),
  voteDigest: z.boolean().optional(),
});

router.get(
  "/me/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser(req).id },
      select: { notificationPrefs: true },
    });
    res.json({ judgingReminders: true, resultsPublished: true, voteDigest: false, ...(user.notificationPrefs as object) });
  }),
);

router.patch(
  "/me/notifications",
  requireAuth,
  validate({ body: prefsSchema }),
  asyncHandler(async (req, res) => {
    const id = currentUser(req).id;
    const current = await prisma.user.findUniqueOrThrow({ where: { id }, select: { notificationPrefs: true } });
    const next = { ...(current.notificationPrefs as object), ...req.body };
    await prisma.user.update({ where: { id }, data: { notificationPrefs: next } });
    res.json({ judgingReminders: true, resultsPublished: true, voteDigest: false, ...next });
  }),
);

router.get(
  "/tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listApiTokens(currentUser(req).id));
  }),
);

router.post(
  "/tokens",
  requireAuth,
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80),
      event: z.string().trim().min(1).max(120).optional(),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.apiToken) throw forbidden("Sign in to create API tokens; a token cannot mint another.");
    const { token, record } = await createApiToken(currentUser(req).id, req.body, req.ipHash);
    res.status(201).json({ ...record, token });
  }),
);

router.delete(
  "/tokens/:tokenId",
  requireAuth,
  validate({ params: z.object({ tokenId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await revokeApiToken(currentUser(req).id, req.params.tokenId as string, req.ipHash);
    res.status(204).end();
  }),
);

export default router;

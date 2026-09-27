import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { eventContext, loadEventContext } from "../middleware/event-context.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { AuditAction, recordAudit } from "../services/audit.service.js";
import {
  assertTeamMember,
  assertTeamOwner,
  createInvite,
  createTeam,
  getMyTeam,
  listTeams,
  loadTeamInEvent,
  removeMember,
  revokeInvite,
  updateTeam,
} from "../services/team.service.js";

const router: Router = Router({ mergeParams: true });

const teamSchema = z.object({
  name: z.string().trim().min(1, "A team name is required.").max(80),
  pitch: z.string().trim().max(500).optional(),
  lookingForMembers: z.boolean().optional(),
});

const inviteSchema = z.object({
  maxUses: z.number().int().min(1).max(50).nullish(),
  expiresAt: z.coerce.date().nullish(),
});

router.get(
  "/",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await listTeams(eventContext(req)));
  }),
);

router.get(
  "/mine",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const team = await getMyTeam(eventContext(req).event.id, currentUser(req).id);
    res.json(team);
  }),
);

router.post(
  "/",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: teamSchema }),
  asyncHandler(async (req, res) => {
    const team = await createTeam(eventContext(req), currentUser(req), req.body, req.ipHash);
    res.status(201).json(team);
  }),
);

router.get(
  "/:teamId",
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    res.json(await loadTeamInEvent(eventContext(req).event.id, req.params.teamId as string));
  }),
);

router.patch(
  "/:teamId",
  requireAuth,
  asyncHandler(loadEventContext),
  validate({ body: teamSchema.partial() }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    res.json(await updateTeam(ctx, team, currentUser(req), req.body, req.ipHash));
  }),
);

router.get(
  "/:teamId/invites",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    assertTeamMember(team, currentUser(req).id);

    // Token hashes are never exposed, so an existing link cannot be recovered.
    res.json(
      await prisma.teamInvite.findMany({
        where: { teamId: team.id },
        select: {
          id: true,
          maxUses: true,
          useCount: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }),
);

router.post(
  "/:teamId/invites",
  requireAuth,
  asyncHandler(loadEventContext),
  writeRateLimit,
  validate({ body: inviteSchema }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    const { invite, token } = await createInvite(
      ctx,
      team,
      currentUser(req),
      req.body,
      req.ipHash,
    );
    res.status(201).json({
      id: invite.id,
      maxUses: invite.maxUses,
      expiresAt: invite.expiresAt,
      token,
      url: `${config.PUBLIC_WEB_URL}/invite/${token}`,
    });
  }),
);

router.delete(
  "/:teamId/invites/:inviteId",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    await revokeInvite(ctx, team, currentUser(req), req.params.inviteId as string, req.ipHash);
    res.status(204).end();
  }),
);

router.delete(
  "/:teamId/members/:userId",
  requireAuth,
  asyncHandler(loadEventContext),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    await removeMember(ctx, team, currentUser(req), req.params.userId as string, req.ipHash);
    res.status(204).end();
  }),
);

router.post(
  "/:teamId/transfer",
  requireAuth,
  asyncHandler(loadEventContext),
  validate({ body: z.object({ userId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const ctx = eventContext(req);
    const team = await loadTeamInEvent(ctx.event.id, req.params.teamId as string);
    const actor = currentUser(req);
    assertTeamOwner(team, actor.id);

    const target = team.members.find((m) => m.userId === req.body.userId);
    if (!target) throw notFound("That person is not on this team.");

    await prisma.$transaction([
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: team.id, userId: actor.id } },
        data: { role: "MEMBER" },
      }),
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: team.id, userId: req.body.userId } },
        data: { role: "OWNER" },
      }),
    ]);
    await recordAudit({
      action: AuditAction.TEAM_OWNER_TRANSFERRED,
      eventId: ctx.event.id,
      actorId: actor.id,
      targetType: "team",
      targetId: team.id,
      summary: `${actor.name} handed ownership of "${team.name}" to ${target.user.name}`,
      metadata: { from: actor.id, to: target.userId },
      ipHash: req.ipHash,
    });

    res.json(await loadTeamInEvent(ctx.event.id, team.id));
  }),
);

export default router;
